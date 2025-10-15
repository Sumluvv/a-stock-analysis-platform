import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import Parser from 'rss-parser';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { spawn } from 'child_process';
import path from 'path';
import { z } from 'zod';
import iconv from 'iconv-lite';
const prisma = new PrismaClient();
const parser = new Parser();
const pgPool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'infostream',
    user: process.env.PGUSER || 'infostream',
    password: process.env.PGPASSWORD || 'infostream',
    // Add safe timeouts to avoid hanging queries
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 5000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 5000),
    idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TX_TIMEOUT_MS || 5000),
});
// Ensure Chinese fuzzy search index exists (pg_trgm + GIN)
async function ensureSearchIndex() {
    const client = await pgPool.connect();
    try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_dim_stock_name_trgm ON dim_stock USING gin (name gin_trgm_ops);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_dim_stock_ts_code ON dim_stock (ts_code);`);
    }
    catch (e) {
        console.error('ensureSearchIndex error:', e);
    }
    finally {
        client.release();
    }
}
// Fire-and-forget; if it fails we just log
ensureSearchIndex();
// 实时更新机制
let updateInterval = null;
let lastRSSUpdate = null;
let lastWebpageUpdate = null;
// 快照缓存机制
const snapshotCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存
// 预连接池 - 复用连接减少延迟
const connectionPool = new Map();
const POOL_CLEANUP_INTERVAL = 30 * 1000; // 30秒清理一次
// 定期清理连接池
setInterval(() => {
    const now = Date.now();
    for (const [url, conn] of connectionPool.entries()) {
        if (now - conn.lastUsed > 60 * 1000) { // 1分钟未使用则清理
            connectionPool.delete(url);
        }
    }
}, POOL_CLEANUP_INTERVAL);
// 更新RSS订阅源
async function updateRSSFeeds() {
    try {
        lastRSSUpdate = new Date();
        const feeds = await prisma.feed.findMany({ include: { items: true } });
        for (const feed of feeds) {
            try {
                // 仅在明确为 RSS/XML 时才解析，避免将普通网页当作 RSS
                let canParse = false;
                try {
                    const headResp = await fetch(feed.url, { method: 'HEAD' });
                    const ct = headResp.headers.get('content-type') || '';
                    if (/xml|rss|atom/i.test(ct))
                        canParse = true;
                }
                catch {
                    // 某些站点不支持 HEAD，再用 GET 探测前 1KB
                    try {
                        const getResp = await fetch(feed.url, { method: 'GET' });
                        const ct = getResp.headers.get('content-type') || '';
                        if (/xml|rss|atom/i.test(ct))
                            canParse = true;
                    }
                    catch { }
                }
                // 粗略规则：URL 后缀包含 .xml/.rss 也视作可解析
                if (!canParse && /\.(xml|rss)(\?|#|$)/i.test(feed.url))
                    canParse = true;
                if (!canParse) {
                    continue;
                }
                const feedData = await parser.parseURL(feed.url);
                if (feedData.items) {
                    for (const item of feedData.items) {
                        // 检查文章是否已存在
                        const existingItem = await prisma.item.findFirst({
                            where: {
                                feedId: feed.id,
                                link: item.link || ''
                            }
                        });
                        if (!existingItem && item.link) {
                            await prisma.item.create({
                                data: {
                                    title: item.title || '无标题',
                                    link: item.link,
                                    content: item.contentSnippet || item.content || '',
                                    published: item.pubDate ? new Date(item.pubDate) : new Date(),
                                    feedId: feed.id
                                }
                            });
                        }
                    }
                }
            }
            catch (error) {
                // 降噪：仅记录简短信息
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`更新RSS失败 ${feed.title}: ${msg}`);
            }
        }
    }
    catch (error) {
        console.error('RSS更新任务失败:', error);
    }
}
// 基于标题分组的通用分段函数
// 通用工具函数
function isSameHost(href, baseUrl) {
    try {
        const baseHost = new URL(baseUrl).hostname;
        const u = new URL(href, baseUrl);
        return u.hostname === baseHost;
    }
    catch {
        return false;
    }
}
function normalizeUrl(href, baseUrl) {
    try {
        return new URL(href, baseUrl).href;
    }
    catch {
        return '';
    }
}
function extractSuggestedTitle(html, url) {
    const $ = cheerio.load(html);
    // 尝试从面包屑导航提取 - 增强版
    const breadcrumbSelectors = [
        // 标准面包屑选择器
        '.breadcrumb a:last-child',
        '.breadcrumb a:last',
        '[class*="breadcrumb"] a:last-child',
        '[class*="当前位置"] a:last-child',
        '[class*="当前位置"] span:last-child',
        // 政府网站常见选择器
        '[class*="位置"] a:last-child',
        '[class*="导航"] a:last-child',
        '[class*="路径"] a:last-child',
        // 通用面包屑模式
        'nav a:last-child',
        'ol a:last-child',
        'ul[class*="nav"] a:last-child'
    ];
    for (const selector of breadcrumbSelectors) {
        const element = $(selector);
        if (element.length) {
            const text = element.text().trim();
            if (text && text.length > 2 && text.length < 50) {
                return text;
            }
        }
    }
    // 尝试从文本中提取面包屑模式
    const breadcrumbTextPatterns = [
        /当前位置[：:]\s*[^>]*>\s*([^>]+)$/,
        /首页\s*>\s*[^>]*>\s*([^>]+)$/,
        /首页\s*>\s*([^>]+)$/,
        /([^>]+)\s*>\s*([^>]+)$/
    ];
    const bodyText = $('body').text();
    for (const pattern of breadcrumbTextPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
            const title = match[1] || match[2];
            if (title && title.trim().length > 2 && title.trim().length < 50) {
                return title.trim();
            }
        }
    }
    // 尝试从页面标题提取
    const title = $('title').text().trim();
    if (title) {
        // 移除常见的网站名称后缀
        const cleanTitle = title.replace(/\s*[-|]\s*.*$/, '').trim();
        if (cleanTitle.length > 2 && cleanTitle.length < 50) {
            return cleanTitle;
        }
    }
    // 尝试从H1标题提取
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length > 2 && h1.length < 50) {
        return h1;
    }
    return new URL(url).hostname;
}
// 链接聚类分段策略
function segmentByClusters(url, html) {
    const $ = cheerio.load(html);
    const hostname = new URL(url).hostname;
    // 收集所有链接
    const links = [];
    $('a[href]').each((_, a) => {
        const text = $(a).text().trim();
        const href = $(a).attr('href') || '';
        if (!text || !href || text.length < 3)
            return;
        const fullUrl = normalizeUrl(href, url);
        if (!isSameHost(fullUrl, url))
            return;
        // 计算容器XPath
        const container = $(a).closest('div, section, article, ul, ol').attr('class') || '';
        const xpath = getElementXPath(a);
        links.push({ text, href, fullUrl, container, xpath });
    });
    // 按容器和路径前缀聚类
    const clusters = new Map();
    links.forEach(link => {
        const pathPrefix = new URL(link.fullUrl).pathname.split('/').slice(0, 3).join('/');
        const clusterKey = `${link.container}-${pathPrefix}`;
        if (!clusters.has(clusterKey)) {
            clusters.set(clusterKey, []);
        }
        clusters.get(clusterKey).push(link);
    });
    // 计算每个聚类的得分
    const scoredClusters = Array.from(clusters.entries()).map(([key, clusterLinks]) => {
        const linkDensity = clusterLinks.length / Math.max(links.length, 1);
        const uniqueHost = 1; // 同域已保证
        const dateHit = clusterLinks.some(link => /20\d{2}[\-\.年]/.test(link.text)) ? 1 : 0;
        const titleDensity = clusterLinks.filter(link => link.text.length > 10 && link.text.length < 100).length / Math.max(clusterLinks.length, 1);
        const score = linkDensity * 0.3 + uniqueHost * 0.2 + dateHit * 0.3 + titleDensity * 0.2;
        return {
            key,
            links: clusterLinks,
            score,
            titleToken: extractClusterTitle(clusterLinks, $)
        };
    });
    // 选择得分最高的聚类
    const topClusters = scoredClusters
        .filter(c => c.score > 0.1 && c.links.length >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    return topClusters.map(cluster => {
        const articles = cluster.links.map(link => ({
            title: link.text,
            link: link.fullUrl,
            pubDate: new Date().toISOString()
        }));
        const bestTitle = selectBestTitle(cluster.titleToken, articles);
        return {
            titleToken: bestTitle,
            articles
        };
    });
}
// 路径模式聚合分段策略
function segmentByPathPatterns(url, html) {
    const $ = cheerio.load(html);
    const hostname = new URL(url).hostname;
    // 收集所有链接并按路径模式分组
    const pathPatterns = new Map();
    $('a[href]').each((_, a) => {
        const text = $(a).text().trim();
        const href = $(a).attr('href') || '';
        if (!text || !href || text.length < 3)
            return;
        const fullUrl = normalizeUrl(href, url);
        if (!isSameHost(fullUrl, url))
            return;
        // 提取路径模式
        const urlObj = new URL(fullUrl);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2) {
            const pattern = `/${pathParts[0]}/${pathParts[1]}`;
            if (!pathPatterns.has(pattern)) {
                pathPatterns.set(pattern, []);
            }
            pathPatterns.get(pattern).push({ text, href, fullUrl });
        }
    });
    // 过滤和排序模式
    const filteredPatterns = Array.from(pathPatterns.entries())
        .filter(([pattern, links]) => {
        // 过滤导航和页脚链接
        const navKeywords = /(nav|menu|footer|header|sidebar|breadcrumb|pagination)/i;
        const hasNavClass = links.some(link => {
            const element = $(`a[href="${link.href}"]`);
            return navKeywords.test(element.closest('[class]').attr('class') || '');
        });
        return !hasNavClass && links.length >= 3;
    })
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 8);
    return filteredPatterns.map(([pattern, links]) => {
        const articles = links.slice(0, 50).map(link => ({
            title: link.text,
            link: link.fullUrl,
            pubDate: new Date().toISOString()
        }));
        const originalTitle = convertPathToTitle(pattern);
        const bestTitle = selectBestTitle(originalTitle, articles);
        return {
            titleToken: bestTitle,
            articles
        };
    });
}
// 合并相似组
function mergeSimilarGroups(allGroups) {
    const merged = new Map();
    allGroups.forEach(group => {
        const key = group.titleToken || group.heading;
        if (!merged.has(key)) {
            merged.set(key, {
                titleToken: key,
                articles: []
            });
        }
        const existing = merged.get(key);
        const existingLinks = new Set(existing.articles.map((a) => a.link));
        group.articles.forEach((article) => {
            if (!existingLinks.has(article.link)) {
                existing.articles.push(article);
                existingLinks.add(article.link);
            }
        });
    });
    return Array.from(merged.values())
        .filter(g => g.articles.length >= 2)
        .sort((a, b) => b.articles.length - a.articles.length);
}
// 辅助函数
function getElementXPath(element) {
    // 简化的XPath生成
    const tagName = element.tagName?.toLowerCase() || 'unknown';
    const className = element.className || '';
    return `${tagName}${className ? '.' + className.split(' ')[0] : ''}`;
}
function extractClusterTitle(links, $) {
    // 尝试从容器标题或第一个链接文本推断标题
    if (links.length === 0)
        return '未命名分组';
    const firstLink = links[0];
    const element = $(`a[href="${firstLink.href}"]`);
    const container = element.closest('div, section, article, h1, h2, h3');
    const containerTitle = container.find('h1, h2, h3').first().text().trim();
    if (containerTitle && containerTitle.length > 2 && containerTitle.length < 50) {
        return containerTitle;
    }
    // 使用第一个链接的文本
    return firstLink.text.length > 50 ? firstLink.text.substring(0, 47) + '...' : firstLink.text;
}
// 智能标题选择函数
function selectBestTitle(originalTitle, articles) {
    if (!originalTitle || articles.length === 0)
        return originalTitle;
    // 过滤掉无用的标题
    const uselessTitles = /^(zwgk|gsgg|zwgk\s+gsgg|2024年度广东省人力资源和社|年度|广东省|人力资源|社会保障|部门|网站|首页|导航|菜单|链接|更多|返回|上一页|下一页|第.*页|共.*页)$/i;
    if (uselessTitles.test(originalTitle)) {
        // 尝试从文章标题中提取更好的标题
        return extractTitleFromArticles(articles);
    }
    // 如果原标题包含面包屑导航模式，尝试提取最后一个部分
    const breadcrumbMatch = originalTitle.match(/^(.+\s*>\s*)+(.+)$/);
    if (breadcrumbMatch && originalTitle.length < 50 && breadcrumbMatch[2]) {
        const lastPart = breadcrumbMatch[2].trim();
        if (lastPart.length > 2 && lastPart.length < 30) {
            return lastPart;
        }
    }
    return originalTitle;
}
// 从文章标题中提取最佳标题
function extractTitleFromArticles(articles) {
    if (articles.length === 0)
        return '未命名分组';
    // 收集所有文章标题
    const titles = articles.map(a => a.title || '').filter(t => t && t.length > 0);
    // 优先寻找短标题（可能是分类标题）
    const shortTitles = titles.filter(title => title.length >= 2 &&
        title.length <= 10 &&
        !/^(首页|上一页|下一页|更多|返回)$/.test(title) &&
        !/^(zwgk|gsgg|2024年度广东省人力资源和社|年度|广东省|人力资源|社会保障|部门|网站|首页|导航|菜单|链接|更多|返回|上一页|下一页|第.*页|共.*页)$/i.test(title));
    if (shortTitles.length > 0) {
        // 如果有多个短标题，选择出现频率最高的
        const titleCount = new Map();
        shortTitles.forEach(title => {
            titleCount.set(title, (titleCount.get(title) || 0) + 1);
        });
        const mostCommon = Array.from(titleCount.entries())
            .sort((a, b) => b[1] - a[1])[0];
        if (mostCommon && mostCommon[1] > 1) {
            return mostCommon[0];
        }
        return shortTitles[0];
    }
    // 寻找共同的关键词
    const commonKeywords = findCommonKeywords(titles);
    if (commonKeywords.length > 0) {
        return commonKeywords[0] || '未命名分组';
    }
    // 寻找最合适的标题
    const bestTitle = titles.find(title => title.length >= 4 &&
        title.length <= 20 &&
        !/^(通知|公告|公示|招聘|拟聘|集中公开招聘|高校毕业生)$/.test(title) &&
        !/^(首页|上一页|下一页|更多|返回)$/.test(title));
    if (bestTitle)
        return bestTitle;
    // 使用第一个标题，但截断过长的
    const firstTitle = titles[0] || '未命名分组';
    return firstTitle.length > 30 ? firstTitle.substring(0, 27) + '...' : firstTitle;
}
// 寻找共同关键词
function findCommonKeywords(titles) {
    const keywordCount = new Map();
    titles.forEach(title => {
        // 提取关键词（去除标点符号，按长度过滤）
        const words = title
            .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length >= 2 && word.length <= 10);
        words.forEach(word => {
            keywordCount.set(word, (keywordCount.get(word) || 0) + 1);
        });
    });
    // 返回出现频率最高的关键词
    return Array.from(keywordCount.entries())
        .filter(([_, count]) => count >= 2) // 至少出现2次
        .sort((a, b) => b[1] - a[1])
        .map(([word, _]) => word)
        .slice(0, 3); // 最多返回3个
}
function convertPathToTitle(pattern) {
    const pathMap = {
        '/news': '新闻动态',
        '/article': '文章列表',
        '/notice': '通知公告',
        '/policy': '政策文件',
        '/zwgk': '政务公开',
        '/gsgg': '公示公告',
        '/sydwzp': '事业单位招聘',
        '/content': '内容列表',
        '/list': '列表页面'
    };
    return pathMap[pattern] || pattern.replace(/\//g, ' ').trim() || '文章分组';
}
// Puppeteer快照获取HTML
async function getSnapshotHtml(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--disable-images',
                '--disable-javascript',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--window-size=1200,800'
            ]
        });
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(5000);
        await page.goto(url, {
            waitUntil: 'domcontentloaded'
        });
        // 等待页面稳定
        await new Promise(resolve => setTimeout(resolve, 1000));
        const html = await page.content();
        return html;
    }
    catch (error) {
        console.log('Puppeteer snapshot failed:', error);
        return null;
    }
    finally {
        if (browser) {
            await browser.close();
        }
    }
}
function segmentByHeadings(url, html) {
    const $ = cheerio.load(html);
    const hostname = new URL(url).hostname;
    const headingSelectors = 'h1, h2, h3';
    const groups = [];
    // 站点与栏目定向规则（减少把“业务网站/友链”当作文章的误判）
    const isRecruitListPage = /hrss\.gd\.gov\.cn/.test(hostname) && /\/zwgk\/sydwzp\//.test(url);
    const blacklistHeadingRegex = /(上级政府网站|各省市人社部门网站|各地市人社部门网站|业务网站|友情链接|网站地图|联系我们)/;
    const recruitKeywordRegex = /(公告|公示|招聘|拟聘|集中公开招聘|高校毕业生)/;
    const dateRegex = /(20\d{2}[\-\.年]\s*\d{1,2}([\-\.月]\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月)/;
    function isLikelyArticle(text, linkHref, contextHeading) {
        if (!text)
            return false;
        if (blacklistHeadingRegex.test(contextHeading))
            return false;
        if (text.length < 5)
            return false;
        // 同域已在外层保证，这里进一步做栏目与关键词约束
        if (isRecruitListPage) {
            if (!recruitKeywordRegex.test(text))
                return false;
        }
        return true;
    }
    $(headingSelectors).each((_, h) => {
        const name = $(h).text().trim();
        if (!name || name.length < 2 || name.length > 30)
            return;
        if (/^首页$|关于|登录|联系我们/.test(name))
            return;
        if (blacklistHeadingRegex.test(name))
            return;
        const currentLevel = parseInt((h.tagName || 'h3').replace(/[^0-9]/g, '')) || 3;
        const articles = [];
        let walker = $(h).next();
        let steps = 0;
        while (walker.length && steps < 25) {
            const tag = walker.get(0)?.tagName?.toLowerCase() || '';
            if (/^h[1-3]$/.test(tag)) {
                const level = parseInt(tag.replace('h', '')) || 3;
                if (level <= currentLevel)
                    break;
            }
            walker.find('a[href]').each((__, a) => {
                const text = $(a).text().trim();
                const href = $(a).attr('href') || '';
                if (!text || !href)
                    return;
                if (text.length < 4 || text.length > 100)
                    return;
                if (/首页|上一页|下一页|更多|返回/.test(text))
                    return;
                // 过滤面包屑导航和页面标题等无用信息
                if (/^(zwgk|gsgg|2024年度广东省人力资源和社|年度|广东省|人力资源|社会保障|部门|网站|首页|导航|菜单|链接|更多|返回|上一页|下一页|第.*页|共.*页)$/i.test(text))
                    return;
                // 过滤面包屑导航模式（如：首页 > 政务公开 > 通知公告）
                if (/^(.+\s*>\s*)+(.+)$/.test(text) && text.length < 50)
                    return;
                const full = normalizeUrl(href, url);
                if (!full || !isSameHost(full, url))
                    return;
                // 简化的文章判断逻辑
                if (text.length < 5 || text.length > 100)
                    return;
                // 附加日期判定：若文本中无日期，尝试在邻近节点找
                const dateRegex = /(20\d{2}[\-\.年]\s*\d{1,2}([\-\.月]\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月)/;
                let hasDate = dateRegex.test(text);
                if (!hasDate) {
                    const near = $(a).parent().text();
                    hasDate = dateRegex.test(near);
                }
                // 对于招聘栏目，优先保留有日期的项
                const isRecruitListPage = /hrss\.gd\.gov\.cn/.test(hostname) && /\/zwgk\/sydwzp\//.test(url);
                if (isRecruitListPage && !hasDate)
                    return;
                articles.push({ title: text.replace(/\s+/g, ' '), link: full, pubDate: new Date().toISOString() });
            });
            walker = walker.next();
            steps++;
        }
        const seen = new Set();
        const unique = articles.filter(a => {
            if (seen.has(a.link))
                return false;
            seen.add(a.link);
            return true;
        }).slice(0, 30);
        if (unique.length >= 2) {
            const bestTitle = selectBestTitle(name, unique);
            groups.push({ heading: bestTitle, articles: unique });
        }
    });
    return groups;
}
// 更新网页RSS订阅源（基于标题分组刷新）
async function updateWebpageFeeds() {
    try {
        lastWebpageUpdate = new Date();
        const feeds = await prisma.feed.findMany({});
        for (const feed of feeds) {
            try {
                // 重新检测网页分类和文章
                const response = await fetch(feed.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                    }
                });
                if (response.ok) {
                    const html = await response.text();
                    // 删除过期文章（超过30天）
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    await prisma.item.deleteMany({
                        where: { feedId: feed.id, published: { lt: thirtyDaysAgo } }
                    });
                    // 若订阅名形如 host/标题，则按标题定位对应分组
                    const host = new URL(feed.url).hostname;
                    const match = feed.title?.startsWith(host + '/') ? feed.title.split('/').slice(1).join('/') : null;
                    let newArticles = [];
                    try {
                        const groups = segmentByHeadings(feed.url, html);
                        if (match) {
                            const g = groups.find(x => x.heading === match);
                            if (g)
                                newArticles = g.articles;
                        }
                        if (!newArticles.length && groups.length && groups[0])
                            newArticles = groups[0].articles;
                    }
                    catch {
                        newArticles = [];
                    }
                    for (const article of newArticles.slice(0, 20)) {
                        const existingItem = await prisma.item.findFirst({
                            where: {
                                feedId: feed.id,
                                link: article.link
                            }
                        });
                        if (!existingItem) {
                            await prisma.item.create({
                                data: {
                                    title: article.title,
                                    link: article.link,
                                    published: new Date(article.pubDate),
                                    feedId: feed.id
                                }
                            });
                        }
                    }
                }
            }
            catch (error) {
                console.error(`更新网页RSS失败 ${feed.title}:`, error);
            }
        }
    }
    catch (error) {
        console.error('网页RSS更新任务失败:', error);
    }
}
// 启动定时更新任务
function startUpdateTasks() {
    // RSS每30秒更新一次
    updateInterval = setInterval(updateRSSFeeds, 30 * 1000);
    // 网页RSS每30分钟更新一次
    setInterval(updateWebpageFeeds, 30 * 60 * 1000);
    console.log('实时更新任务已启动: RSS每30秒, 网页RSS每30分钟');
}
// 停止更新任务
function stopUpdateTasks() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}
export async function feedRoutes(app) {
    // 启动实时更新任务（可通过环境变量关闭以避免占用资源导致卡顿）
    if (!process.env.FEEDS_DISABLE_TASKS) {
        startUpdateTasks();
    }
    else {
        app.log.info('Feed update tasks are disabled by FEEDS_DISABLE_TASKS');
    }
    // 仅对需要的路由启用鉴权；公开数据接口放行
    app.addHook('onRequest', async (req, reply) => {
        const url = req.url || '';
        const method = (req.method || 'GET').toUpperCase();
        const isPublicGet = method === 'GET' && (/\/kline\//.test(url) ||
            /\/overview\//.test(url) ||
            /\/update-info$/.test(url) ||
            /\/search(\?|$)/.test(url) ||
            /\/hot(\?|$)/.test(url) ||
            /\/data-status\//.test(url));
        const isPublicPost = method === 'POST' && (/\/auto-import\//.test(url));
        if (isPublicGet || isPublicPost)
            return;
        try {
            await req.jwtVerify();
        }
        catch {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
    });
    app.get('/', async (req, reply) => {
        const userId = req.user?.sub;
        const feeds = await prisma.feed.findMany({
            where: { userId },
            include: { group: true },
            orderBy: { createdAt: 'desc' }
        });
        return { feeds };
    });
    app.get('/groups', async (req, reply) => {
        const userId = req.user?.sub;
        const groups = await prisma.group.findMany({
            where: { userId },
            include: { feeds: true },
            orderBy: { createdAt: 'asc' }
        });
        return { groups };
    });
    // Kline + indicators
    app.get('/kline/:ts_code', async (req, reply) => {
        const schema = z.object({
            ts_code: z.string(),
            period: z.enum(['d', 'w', 'm']).optional().default('d'),
            start: z.string().optional(),
            end: z.string().optional(),
            include_indicators: z.coerce.boolean().optional().default(true)
        });
        const params = schema.safeParse({ ...(req.params || {}), ...(req.query || {}) });
        if (!params.success)
            return reply.code(400).send({ error: 'Invalid params' });
        const { ts_code, period, start, end, include_indicators } = params.data;
        const freq = period.toUpperCase();
        const client = await pgPool.connect();
        try {
            const values = [ts_code, freq];
            let where = 'p.ts_code = $1 AND p.freq = $2';
            if (start) {
                values.push(start);
                where += ` AND p.trade_date >= $${values.length}`;
            }
            if (end) {
                values.push(end);
                where += ` AND p.trade_date <= $${values.length}`;
            }
            const baseSql = `SELECT p.trade_date, p.open, p.high, p.low, p.close, p.vol, p.amount
                       FROM prices_ohlcv p WHERE ${where} ORDER BY p.trade_date`;
            const { rows: prices } = await client.query(baseSql, values);
            let indicators = [];
            if (include_indicators) {
                const { rows } = await client.query(`SELECT trade_date, ma5, ma10, ma20, macd, macd_signal, macd_hist, rsi6, rsi14, boll_upper, boll_mid, boll_lower
           FROM tech_indicators WHERE ts_code=$1 AND freq=$2 AND trade_date BETWEEN COALESCE($3::date, '0001-01-01') AND COALESCE($4::date, '9999-12-31')
           ORDER BY trade_date`, [ts_code, freq, start || null, end || null]);
                indicators = rows;
            }
            return { ts_code, freq, prices, indicators };
        }
        catch (e) {
            return reply.code(500).send({ error: 'Failed to load kline', message: e?.message });
        }
        finally {
            client.release();
        }
    });
    // Search dim_stock by keyword (ts_code or name)
    app.get('/search', async (req, reply) => {
        try {
            const q = req.query?.q;
            const limit = parseInt(req.query?.limit) || 20;
            if (!q || q.trim().length === 0) {
                return reply.code(400).send({ error: 'Query parameter q is required' });
            }
            if (limit < 1 || limit > 100) {
                return reply.code(400).send({ error: 'Limit must be between 1 and 100' });
            }
            const client = await pgPool.connect();
            try {
                // Prefer exact code match first, then fuzzy name/code match; limit overall
                const keyword = `%${q.trim()}%`;
                const { rows } = await client.query(`(
             SELECT ts_code, name, industry, list_date, exchange
             FROM dim_stock
             WHERE ts_code = $1
           )
           UNION ALL
           (
             SELECT ts_code, name, industry, list_date, exchange
             FROM dim_stock
             WHERE (ts_code ILIKE $2 OR name ILIKE $2)
               AND ts_code <> $1
             ORDER BY ts_code
             LIMIT $3
           )`, [q.trim(), keyword, limit]);
                return reply.send({ items: rows });
            }
            catch (e) {
                console.error('Search error:', e);
                return reply.code(500).send({ error: 'Failed to search stocks', message: e?.message });
            }
            finally {
                client.release();
            }
        }
        catch (e) {
            console.error('Search validation error:', e);
            return reply.code(400).send({ error: 'Invalid request', message: e?.message });
        }
    });
    // Hot stocks: recent movers by pct_chg or volume over last trade day
    app.get('/hot', async (req, reply) => {
        const schema = z.object({ limit: z.coerce.number().min(1).max(100).optional().default(12) });
        const parsed = schema.safeParse({ ...(req.query || {}) });
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid query' });
        const { limit } = parsed.data;
        const client = await pgPool.connect();
        try {
            // 选取最近一个交易日的数据，按涨跌幅绝对值与成交额综合排序
            const { rows: recentDateRows } = await client.query(`SELECT MAX(trade_date) AS latest FROM prices_ohlcv WHERE freq='D'`);
            const latest = recentDateRows[0]?.latest;
            if (!latest)
                return { items: [] };
            const { rows } = await client.query(`SELECT p.ts_code, d.name, d.industry, d.exchange,
                p.trade_date, p.close, p.pct_chg, p.vol, p.amount
         FROM prices_ohlcv p
         JOIN dim_stock d ON d.ts_code = p.ts_code
         WHERE p.freq='D' AND p.trade_date = $1
         ORDER BY GREATEST(ABS(COALESCE(p.pct_chg,0)), 0) DESC, COALESCE(p.amount,0) DESC
         LIMIT $2`, [latest, limit]);
            return { items: rows };
        }
        catch (e) {
            return reply.code(500).send({ error: 'Failed to load hot stocks', message: e?.message });
        }
        finally {
            client.release();
        }
    });
    // Overview
    app.get('/overview/:ts_code', async (req, reply) => {
        const schema = z.object({ ts_code: z.string() });
        const parsed = schema.safeParse(req.params);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid ts_code' });
        const { ts_code } = parsed.data;
        const client = await pgPool.connect();
        try {
            const { rows: basic } = await client.query('SELECT * FROM dim_stock WHERE ts_code=$1', [ts_code]);
            const { rows: latestPrices } = await client.query(`SELECT trade_date, close FROM prices_ohlcv WHERE ts_code=$1 AND freq='D' ORDER BY trade_date DESC LIMIT 1`, [ts_code]);
            const { rows: latestAI } = await client.query(`SELECT as_of_date, score, action FROM ai_scores WHERE ts_code=$1 ORDER BY as_of_date DESC LIMIT 1`, [ts_code]);
            return { basic: basic[0] || null, last_price: latestPrices[0] || null, ai: latestAI[0] || null };
        }
        catch (e) {
            return reply.code(500).send({ error: 'Failed to load overview', message: e?.message });
        }
        finally {
            client.release();
        }
    });
    // 一键导入指定股票的基础数据（K线 + 技术指标 + 可选财务）
    app.post('/auto-import/:ts_code', async (req, reply) => {
        const schema = z.object({ ts_code: z.string() });
        const parsed = schema.safeParse(req.params);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid ts_code' });
        const { ts_code } = parsed.data;
        try {
            const etlDir = path.resolve(process.cwd(), '..', 'etl');
            // 运行 Python 脚本的改进版本，带重试机制
            const runPy = (script, args = [], retries = 2) => new Promise((resolve, reject) => {
                const attempt = (attemptNum) => {
                    const venvPython = path.join(etlDir, '.venv', 'bin', 'python');
                    const p = spawn(venvPython, [path.join(etlDir, script), ...args], {
                        cwd: etlDir,
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    let stdout = '';
                    let stderr = '';
                    p.stdout?.on('data', (data) => {
                        stdout += data.toString();
                    });
                    p.stderr?.on('data', (data) => {
                        stderr += data.toString();
                    });
                    p.on('error', (error) => {
                        console.error(`[${script}] Process error (attempt ${attemptNum}):`, error);
                        if (attemptNum < retries) {
                            console.log(`[${script}] Retrying... (${attemptNum + 1}/${retries})`);
                            setTimeout(() => attempt(attemptNum + 1), 1000);
                        }
                        else {
                            reject(new Error(`${script} process error: ${error.message}`));
                        }
                    });
                    p.on('close', (code) => {
                        if (code === 0) {
                            console.log(`[${script}] Success for ${ts_code}`);
                            resolve();
                        }
                        else {
                            console.error(`[${script}] Exit code ${code} for ${ts_code}`);
                            console.error(`[${script}] stderr:`, stderr);
                            if (attemptNum < retries) {
                                console.log(`[${script}] Retrying... (${attemptNum + 1}/${retries})`);
                                setTimeout(() => attempt(attemptNum + 1), 2000);
                            }
                            else {
                                reject(new Error(`${script} exit ${code}: ${stderr}`));
                            }
                        }
                    });
                };
                attempt(1);
            });
            // 后台顺序执行：K线 -> 指标 -> 财务 -> 估值 -> AI评分
            // 使用 async/await 确保顺序执行和错误处理
            (async () => {
                try {
                    console.log(`🚀 开始导入 ${ts_code} 的数据...`);
                    // 1. 导入K线数据
                    console.log(`📊 导入K线数据: ${ts_code}`);
                    await runPy('import_ohlcv.py', [ts_code]);
                    // 2. 计算技术指标
                    console.log(`📈 计算技术指标: ${ts_code}`);
                    await runPy('compute_indicators.py', [ts_code]);
                    // 3. 导入财务数据
                    console.log(`💰 导入财务数据: ${ts_code}`);
                    await runPy('ingest_financials.py', [ts_code]);
                    // 4. 计算估值
                    console.log(`📊 计算估值: ${ts_code}`);
                    await runPy('compute_valuations.py', [ts_code]);
                    // 5. 计算AI评分
                    console.log(`🤖 计算AI评分: ${ts_code}`);
                    await runPy('simple_ai_scoring.py', [ts_code]);
                    // 6. 计算DCF估值
                    console.log(`💰 计算DCF估值: ${ts_code}`);
                    await runPy('dcf_valuation.py', [ts_code]);
                    console.log(`✅ ${ts_code} 数据导入完成！`);
                }
                catch (e) {
                    console.error(`❌ ${ts_code} 数据导入失败:`, e?.message || e);
                }
            })();
            return reply.send({ message: 'Import started', ts_code });
        }
        catch (e) {
            return reply.code(500).send({ error: 'Failed to start import', message: e?.message });
        }
    });
    // 检查股票数据完整性
    app.get('/data-status/:ts_code', async (req, reply) => {
        const schema = z.object({ ts_code: z.string() });
        const parsed = schema.safeParse(req.params);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid ts_code' });
        const { ts_code } = parsed.data;
        try {
            const client = await pgPool.connect();
            try {
                const status = {
                    ts_code,
                    has_overview: false,
                    has_kline: false,
                    has_valuation: false,
                    has_ai_score: false,
                    has_dcf: false,
                    last_updated: null
                };
                // 检查概览数据（从dim_stock表检查）
                const overviewResult = await client.query('SELECT COUNT(*) as count FROM dim_stock WHERE ts_code = $1', [ts_code]);
                status.has_overview = parseInt(overviewResult.rows[0].count) > 0;
                // 检查K线数据
                const klineResult = await client.query('SELECT COUNT(*) as count FROM prices_ohlcv WHERE ts_code = $1', [ts_code]);
                status.has_kline = parseInt(klineResult.rows[0].count) > 0;
                // 检查估值数据
                const valuationResult = await client.query('SELECT COUNT(*) as count FROM valuations WHERE ts_code = $1', [ts_code]);
                status.has_valuation = parseInt(valuationResult.rows[0].count) > 0;
                // 检查AI评分数据
                const aiResult = await client.query('SELECT COUNT(*) as count FROM ai_scores WHERE ts_code = $1', [ts_code]);
                status.has_ai_score = parseInt(aiResult.rows[0].count) > 0;
                // 检查DCF数据（DCF数据存储在valuations表中，method='DCF'）
                const dcfResult = await client.query('SELECT COUNT(*) as count FROM valuations WHERE ts_code = $1 AND method = $2', [ts_code, 'DCF']);
                status.has_dcf = parseInt(dcfResult.rows[0].count) > 0;
                // 获取最后更新时间
                const lastUpdateResult = await client.query(`SELECT MAX(created_at) as last_updated FROM (
            SELECT created_at FROM valuations WHERE ts_code = $1
            UNION ALL
            SELECT created_at FROM ai_scores WHERE ts_code = $1
          ) as all_data`, [ts_code]);
                status.last_updated = lastUpdateResult.rows[0].last_updated;
                return reply.send(status);
            }
            finally {
                client.release();
            }
        }
        catch (e) {
            return reply.code(500).send({ error: 'Failed to check data status', message: e?.message });
        }
    });
    // 获取更新信息
    app.get('/update-info', async (req, reply) => {
        return {
            rssUpdateFrequency: 30, // 30秒
            webpageUpdateFrequency: 30, // 30分钟
            lastRSSUpdate: lastRSSUpdate,
            lastWebpageUpdate: lastWebpageUpdate
        };
    });
    app.post('/import', async (req, reply) => {
        const schema = z.object({ url: z.string().url() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid url' });
        const userId = req.user?.sub;
        const { url } = parsed.data;
        try {
            const feedData = await parser.parseURL(url);
            console.log('RSS Feed Data:', {
                title: feedData.title,
                link: feedData.link,
                description: feedData.description,
                itemsCount: feedData.items?.length || 0
            });
            // 尝试从多个字段获取标题
            const feedTitle = feedData.title ||
                feedData.link?.replace(/^https?:\/\//, '').replace(/\/$/, '') ||
                '未命名订阅源';
            const feed = await prisma.feed.create({
                data: {
                    userId,
                    url,
                    title: feedTitle
                }
            });
            if (feedData.items?.length) {
                const toCreate = feedData.items.slice(0, 100).map((it) => ({
                    feedId: feed.id,
                    guid: it.guid || null,
                    link: it.link || null,
                    title: it.title || null,
                    content: (it.contentSnippet || it.content) || null,
                    published: it.isoDate ? new Date(it.isoDate) : null,
                }));
                for (const data of toCreate) {
                    await prisma.item.upsert({
                        where: { guid: data.guid ?? `guid:${Math.random()}` },
                        create: data,
                        update: data,
                    });
                }
            }
            return {
                id: feed.id,
                title: feedTitle,
                url: url,
                groupId: null,
                group: null
            };
        }
        catch (error) {
            console.error('RSS Import Error:', error);
            let errorMessage = 'Unknown error';
            let suggestion = '请检查RSS链接是否正确';
            if (error instanceof Error) {
                const message = error.message;
                // 分析具体错误类型
                if (message.includes('Status code 404')) {
                    errorMessage = 'RSS链接不存在 (404)';
                    suggestion = '该RSS链接可能已失效，请检查链接是否正确或联系网站管理员';
                }
                else if (message.includes('Status code 504') || message.includes('Gateway Time-out')) {
                    errorMessage = '服务器响应超时 (504)';
                    suggestion = '服务器暂时无法响应，请稍后重试或检查网络连接';
                }
                else if (message.includes('Status code 403')) {
                    errorMessage = '访问被拒绝 (403)';
                    suggestion = '该RSS链接可能需要特殊权限访问，请检查是否需要登录';
                }
                else if (message.includes('Status code 500')) {
                    errorMessage = '服务器内部错误 (500)';
                    suggestion = 'RSS服务器出现问题，请稍后重试';
                }
                else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
                    errorMessage = '域名无法解析';
                    suggestion = '网站域名可能已失效或不存在，请检查链接是否正确';
                }
                else if (message.includes('ECONNREFUSED')) {
                    errorMessage = '连接被拒绝';
                    suggestion = '无法连接到RSS服务器，请检查网络连接';
                }
                else if (message.includes('timeout')) {
                    errorMessage = '连接超时';
                    suggestion = '网络连接超时，请检查网络状况后重试';
                }
                else if (message.includes('Invalid XML') || message.includes('XML parsing')) {
                    errorMessage = 'RSS格式错误';
                    suggestion = '该链接不是有效的RSS格式，请确认链接是否正确';
                }
                else {
                    errorMessage = message;
                }
            }
            return reply.code(500).send({
                error: 'Failed to import RSS feed',
                message: errorMessage,
                suggestion: suggestion
            });
        }
    });
    app.get('/:id/items', async (req, reply) => {
        const { id } = req.params;
        const items = await prisma.item.findMany({ where: { feedId: id }, orderBy: { published: 'desc' } });
        return { items };
    });
    // 删除订阅源
    app.delete('/:id', async (req, reply) => {
        const { id } = req.params;
        const userId = req.user?.sub;
        try {
            // 先删除相关的文章
            await prisma.item.deleteMany({ where: { feedId: id } });
            // 再删除订阅源
            await prisma.feed.delete({ where: { id, userId } });
            return { success: true };
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to delete feed' });
        }
    });
    // 创建分组
    app.post('/groups', async (req, reply) => {
        const schema = z.object({
            name: z.string().min(1),
            color: z.string().optional()
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid payload' });
        const userId = req.user?.sub;
        const { name, color } = parsed.data;
        try {
            const group = await prisma.group.create({
                data: { userId, name, color: color || '#3b82f6' }
            });
            return group;
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to create group' });
        }
    });
    // 更新订阅源分组
    app.patch('/:id/group', async (req, reply) => {
        const { id } = req.params;
        const schema = z.object({ groupId: z.string().nullable() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid payload' });
        const userId = req.user?.sub;
        const { groupId } = parsed.data;
        try {
            const feed = await prisma.feed.update({
                where: { id, userId },
                data: { groupId }
            });
            return feed;
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to update feed group' });
        }
    });
    // 获取分组的所有文章
    app.get('/groups/:groupId/items', async (req, reply) => {
        const { groupId } = req.params;
        const userId = req.user?.sub;
        try {
            const items = await prisma.item.findMany({
                where: {
                    feed: {
                        groupId,
                        userId
                    }
                },
                include: {
                    feed: {
                        select: {
                            id: true,
                            title: true,
                            group: {
                                select: {
                                    id: true,
                                    name: true,
                                    color: true
                                }
                            }
                        }
                    }
                },
                orderBy: { published: 'desc' }
            });
            return { items };
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to load group items' });
        }
    });
    // 网页转 RSS 功能
    app.post('/webpage-to-rss', async (req, reply) => {
        const schema = z.object({
            url: z.string().url(),
            selectors: z.object({
                title: z.string(),
                content: z.string(),
                link: z.string().optional(),
                time: z.string().optional()
            })
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid payload' });
        const { url, selectors } = parsed.data;
        const userId = req.user?.sub;
        try {
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2' });
            // 使用选择器抓取内容
            const scrapedData = await page.evaluate((sel) => {
                const elements = document.querySelectorAll(sel.title);
                const items = [];
                for (let i = 0; i < Math.min(elements.length, 10); i++) {
                    const element = elements[i];
                    if (!element)
                        continue;
                    const title = element.textContent?.trim() || '';
                    const link = element.closest('a')?.href || '';
                    // 尝试找到对应的内容
                    const contentEl = element.closest('*')?.querySelector(sel.content);
                    const content = contentEl?.textContent?.trim() || '';
                    // 尝试找到时间
                    const timeEl = sel.time ? element.closest('*')?.querySelector(sel.time) : null;
                    const time = timeEl?.textContent?.trim() || new Date().toISOString();
                    if (title) {
                        items.push({ title, content, link, time });
                    }
                }
                return items;
            }, selectors);
            await browser.close();
            // 创建 Feed
            const feed = await prisma.feed.create({
                data: {
                    userId,
                    url,
                    title: `网页抓取`
                }
            });
            // 保存抓取的文章
            for (const item of scrapedData) {
                await prisma.item.create({
                    data: {
                        feedId: feed.id,
                        title: item.title,
                        content: item.content,
                        link: item.link,
                        published: new Date(item.time),
                    }
                });
            }
            return { id: feed.id, items: scrapedData };
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to scrape webpage' });
        }
    });
    // 获取网页预览（用于选择器测试）
    app.post('/webpage-preview', async (req, reply) => {
        const schema = z.object({ url: z.string().url() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid url' });
        const { url } = parsed.data;
        try {
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2' });
            // 获取页面标题和可能的文章元素
            const pageInfo = await page.evaluate(() => {
                const title = document.title;
                const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                    .map(h => ({ text: h.textContent?.trim(), tag: h.tagName }));
                const links = Array.from(document.querySelectorAll('a[href]'))
                    .slice(0, 10)
                    .map(a => ({ text: a.textContent?.trim(), href: a.getAttribute('href') || '' }));
                return { title, headings, links };
            });
            await browser.close();
            return pageInfo;
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to preview webpage' });
        }
    });
    // 删除分组
    app.delete('/groups/:groupId', async (req, reply) => {
        const { groupId } = req.params;
        const userId = req.user?.sub;
        try {
            // 检查分组是否存在且属于当前用户
            const group = await prisma.group.findFirst({
                where: { id: groupId, userId }
            });
            if (!group) {
                return reply.code(404).send({ error: 'Group not found' });
            }
            // 将分组中的订阅源设为未分组
            await prisma.feed.updateMany({
                where: { groupId, userId },
                data: { groupId: null }
            });
            // 删除分组
            await prisma.group.delete({
                where: { id: groupId }
            });
            return { success: true };
        }
        catch (error) {
            return reply.code(500).send({ error: 'Failed to delete group' });
        }
    });
    // 网页转RSS - 智能分类检测
    app.post('/webpage-categories', async (req, reply) => {
        const schema = z.object({ url: z.string().url() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid url' });
        const { url } = parsed.data;
        try {
            // 首先尝试使用cheerio快速解析静态内容
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
            });
            if (!response.ok) {
                return reply.code(400).send({ error: 'Failed to fetch webpage' });
            }
            const html = await response.text();
            const $ = cheerio.load(html);
            // 站点定制：广东省人力资源和社会保障厅（hrss.gd.gov.cn）
            // 精准抓取“规范性文件”“事业单位公开招聘”等分类，并在对应页面下钻解析文章列表
            const hostname = new URL(url).hostname;
            if (hostname.includes('hrss.gd.gov.cn')) {
                const siteCategories = [
                    { name: '规范性文件', hrefCandidates: ['规范性文件', '/gfxwj', '/zcfg/gfxwj'] },
                    { name: '政策解读', hrefCandidates: ['政策解读', '/zcjd'] },
                    { name: '通知公告', hrefCandidates: ['通知公告', '/tzgg'] },
                    { name: '事业单位公开招聘', hrefCandidates: ['事业单位公开招聘', '公开招聘'] }
                ];
                const allowedPathWhitelist = ['/zwgk/sydwzp/'];
                const blacklistText = /(信息网|考试网|招聘网|门户|上级政府网站|各省市人社部门网站|各地市人社部门网站|业务网站|友情链接)/;
                async function fetchListPage(listUrl) {
                    try {
                        const res = await fetch(listUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                            },
                        });
                        if (!res.ok)
                            return [];
                        const html2 = await res.text();
                        const $$ = cheerio.load(html2);
                        const articles = [];
                        // 常见列表结构：ul li a, .list a, .news-list a
                        $$('ul li a, .list a, .news-list a, .article-list a, .info-list a').each((_, a) => {
                            const text = $$(a).text().trim();
                            const href = $$(a).attr('href');
                            if (!href || !text || text.length < 5)
                                return;
                            // 过滤外部站点导航类链接
                            if (blacklistText.test(text))
                                return;
                            const fullUrl = href.startsWith('http') ? href : new URL(href, listUrl).href;
                            // 过滤导航/面包屑等非文章链接
                            if (/首页|上一页|下一页|更多|返回/.test(text))
                                return;
                            // 过滤面包屑导航和页面标题等无用信息
                            if (/^(zwgk|gsgg|2024年度广东省人力资源和社|年度|广东省|人力资源|社会保障|部门|网站|首页|导航|菜单|链接|更多|返回|上一页|下一页|第.*页|共.*页)$/i.test(text))
                                return;
                            // 过滤面包屑导航模式（如：首页 > 政务公开 > 通知公告）
                            if (/^(.+\s*>\s*)+(.+)$/.test(text) && text.length < 50)
                                return;
                            // 仅保留栏目内路径
                            try {
                                const p = new URL(fullUrl).pathname;
                                if (!allowedPathWhitelist.some(w => p.startsWith(w)))
                                    return;
                            }
                            catch { }
                            articles.push({ title: text, link: fullUrl, pubDate: new Date().toISOString() });
                        });
                        return articles.slice(0, 15);
                    }
                    catch {
                        return [];
                    }
                }
                const categories = [];
                for (const cfg of siteCategories) {
                    // 在首页内寻找相关入口链接
                    let candidateHref = null;
                    $('a').each((_, a) => {
                        const text = $(a).text().trim();
                        const href = $(a).attr('href') || '';
                        if (candidateHref)
                            return;
                        const matchedByText = cfg.hrefCandidates.some(k => text.includes(k));
                        const matchedByPath = cfg.hrefCandidates.some(k => k.startsWith('/') && href.includes(k));
                        if ((matchedByText || matchedByPath) && href) {
                            candidateHref = href.startsWith('http') ? href : new URL(href, url).href;
                        }
                    });
                    // 如果首页没找到，尝试根据已知路径猜测一个列表入口
                    if (!candidateHref) {
                        const guesses = cfg.hrefCandidates.filter(k => k.startsWith('/'));
                        if (guesses.length > 0 && guesses[0]) {
                            candidateHref = new URL(guesses[0], url).href;
                        }
                    }
                    if (candidateHref) {
                        // 入口也要求在白名单路径下
                        try {
                            const p = new URL(candidateHref).pathname;
                            if (!allowedPathWhitelist.some(w => p.startsWith(w))) {
                                candidateHref = null;
                            }
                        }
                        catch { }
                    }
                    if (candidateHref) {
                        const articles = await fetchListPage(candidateHref);
                        if (articles.length > 0) {
                            categories.push({ name: cfg.name, selector: 'a', articles });
                        }
                    }
                }
                if (categories.length > 0) {
                    return { categories };
                }
                // 若定制失败则继续走通用检测
            }
            // 通用方案：按 H1/H2/H3 标题分组，抽取其后相邻区域的文章链接
            const headingSelectors = 'h1, h2, h3';
            const categoriesByHeading = [];
            $(headingSelectors).each((_, h) => {
                const name = $(h).text().trim();
                if (!name || name.length < 2 || name.length > 30)
                    return;
                if (/^首页$|关于|登录|联系我们/.test(name))
                    return;
                // 向后查找直到遇到下一个同级或更高等级标题
                const currentLevel = parseInt((h.tagName || 'h3').replace(/[^0-9]/g, '')) || 3;
                const articles = [];
                let walker = $(h).next();
                let steps = 0;
                while (walker.length && steps < 20) {
                    const tag = walker.get(0)?.tagName?.toLowerCase() || '';
                    if (/^h[1-3]$/.test(tag)) {
                        const level = parseInt(tag.replace('h', '')) || 3;
                        if (level <= currentLevel)
                            break;
                    }
                    // 抽取列表或段落中的 a 链接
                    walker.find('a[href]').each((__, a) => {
                        const text = $(a).text().trim();
                        const href = $(a).attr('href') || '';
                        if (!text || !href)
                            return;
                        if (text.length < 4 || text.length > 100)
                            return;
                        if (/首页|上一页|下一页|更多|返回/.test(text))
                            return;
                        // 过滤面包屑导航和页面标题等无用信息
                        if (/^(zwgk|gsgg|2024年度广东省人力资源和社|年度|广东省|人力资源|社会保障|部门|网站|首页|导航|菜单|链接|更多|返回|上一页|下一页|第.*页|共.*页)$/i.test(text))
                            return;
                        // 过滤面包屑导航模式（如：首页 > 政务公开 > 通知公告）
                        if (/^(.+\s*>\s*)+(.+)$/.test(text) && text.length < 50)
                            return;
                        const full = normalizeUrl(href, url);
                        if (!full || !isSameHost(full, url))
                            return; // 仅同域
                        articles.push({ title: text, link: full, pubDate: new Date().toISOString() });
                    });
                    // 如果当前节点本身就是列表，也抓取
                    if (/(ul|ol|div|section)/.test(tag)) {
                        walker.find('li a[href], .list a[href], .news a[href], .item a[href]').each((__, a) => {
                            const text = $(a).text().trim();
                            const href = $(a).attr('href') || '';
                            if (!text || !href)
                                return;
                            const full = normalizeUrl(href, url);
                            if (!full || !isSameHost(full, url))
                                return;
                            if (/首页|上一页|下一页|更多|返回/.test(text))
                                return;
                            if (text.length < 4 || text.length > 100)
                                return;
                            // 简化的文章判断逻辑
                            if (text.length < 5 || text.length > 100)
                                return;
                            // 过滤面包屑导航和页面标题等无用信息
                            if (/^(zwgk|gsgg|2024年度广东省人力资源和社|年度|广东省|人力资源|社会保障|部门|网站|首页|导航|菜单|链接|更多|返回|上一页|下一页|第.*页|共.*页)$/i.test(text))
                                return;
                            // 过滤面包屑导航模式（如：首页 > 政务公开 > 通知公告）
                            if (/^(.+\s*>\s*)+(.+)$/.test(text) && text.length < 50)
                                return;
                            const dateRegex = /(20\d{2}[\-\.年]\s*\d{1,2}([\-\.月]\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月)/;
                            let hasDate = dateRegex.test(text) || dateRegex.test($(a).parent().text());
                            const isRecruitListPage = /hrss\.gd\.gov\.cn/.test(hostname) && /\/zwgk\/sydwzp\//.test(url);
                            if (isRecruitListPage && !hasDate)
                                return;
                            articles.push({ title: text.replace(/\s+/g, ' '), link: full, pubDate: new Date().toISOString() });
                        });
                    }
                    walker = walker.next();
                    steps++;
                }
                // 去重并限量
                const seen = new Set();
                const uniqueArticles = articles.filter(a => {
                    if (seen.has(a.link))
                        return false;
                    seen.add(a.link);
                    return true;
                }).slice(0, 20);
                if (uniqueArticles.length >= 2) {
                    categoriesByHeading.push({ name, selector: 'heading', articles: uniqueArticles });
                }
            });
            if (categoriesByHeading.length > 0) {
                return { categories: categoriesByHeading.slice(0, 12) };
            }
            return { categories: [] };
        }
        catch (error) {
            console.error('网页分类检测失败:', error);
            return reply.code(500).send({
                error: 'Failed to detect categories',
                message: '网页分类检测失败，请检查URL是否正确'
            });
        }
    });
    // 网页快照功能 - 超快速版本
    app.post('/webpage-snapshot', async (req, reply) => {
        const schema = z.object({ url: z.string().url() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid url' });
        const { url } = parsed.data;
        // 检查缓存
        const cached = snapshotCache.get(url);
        if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            console.log(`使用缓存的快照: ${url}`);
            return cached.data;
        }
        try {
            console.log(`开始生成网页快照: ${url}`);
            const startTime = Date.now();
            // 智能重试机制
            let lastError;
            let response;
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    if (attempt > 1) {
                        console.log(`重试第${attempt}次: ${url}`);
                        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms延迟重试
                    }
                    // 使用超快速fetch配置
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), attempt === 1 ? 1500 : 2000); // 第一次1.5秒，第二次2秒
                    // 检查连接池
                    const hostname = new URL(url).hostname;
                    const poolKey = hostname;
                    const poolConn = connectionPool.get(poolKey);
                    response = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; InfoStream/1.0)',
                            'Accept': 'text/html,application/xhtml+xml',
                            'Accept-Language': 'zh-CN,zh;q=0.8,en;q=0.6',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Connection': poolConn?.keepAlive ? 'keep-alive' : 'close',
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        },
                        signal: controller.signal,
                        // 添加更多优化选项
                        redirect: 'follow'
                    });
                    // 更新连接池
                    connectionPool.set(poolKey, {
                        lastUsed: Date.now(),
                        keepAlive: response.headers.get('connection')?.toLowerCase().includes('keep-alive') || false
                    });
                    clearTimeout(timeoutId);
                    // 如果成功，跳出重试循环
                    break;
                }
                catch (error) {
                    lastError = error;
                    if (attempt === 2) {
                        throw error; // 最后一次重试失败，抛出错误
                    }
                    console.log(`第${attempt}次尝试失败: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const html = await response.text();
            const parseTime = Date.now();
            console.log(`HTML获取耗时: ${parseTime - startTime}ms`);
            const $ = cheerio.load(html);
            // 快速提取基本信息
            const title = $('title').first().text().trim().substring(0, 50) || '无标题';
            const description = $('meta[name="description"]').first().attr('content')?.substring(0, 100) || '';
            // 快速提取主要内容 - 只取前200字符
            const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
            const textContent = bodyText.substring(0, 200);
            // 快速提取链接 - 只取前5个
            const links = [];
            $('a[href^="http"]').slice(0, 5).each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim().substring(0, 30);
                if (href && text) {
                    links.push({ href, text });
                }
            });
            // 生成简化的SVG预览图
            const svgContent = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8f9fa"/>
        <rect x="20" y="20" width="760" height="50" fill="#fff" stroke="#ddd" rx="4"/>
        <text x="30" y="40" font-family="Arial" font-size="16" font-weight="bold" fill="#333">${title}</text>
        <text x="30" y="55" font-family="Arial" font-size="11" fill="#666">${url}</text>
        <rect x="20" y="90" width="760" height="200" fill="#fff" stroke="#ddd" rx="4"/>
        <text x="30" y="110" font-family="Arial" font-size="12" fill="#555">${textContent}</text>
        <rect x="20" y="310" width="760" height="70" fill="#fff" stroke="#ddd" rx="4"/>
        <text x="30" y="330" font-family="Arial" font-size="12" font-weight="bold" fill="#333">相关链接 (${links.length})</text>
        ${links.slice(0, 3).map((link, i) => `<text x="30" y="${350 + i * 15}" font-family="Arial" font-size="10" fill="#0066cc">• ${link.text}</text>`).join('')}
        <text x="30" y="385" font-family="Arial" font-size="10" fill="#999">${new Date().toLocaleTimeString()}</text>
      </svg>`;
            const endTime = Date.now();
            console.log(`网页快照生成成功: ${url} (总耗时: ${endTime - startTime}ms)`);
            const result = {
                screenshot: `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`,
                url,
                title,
                description,
                textContent: textContent + '...',
                linksCount: links.length
            };
            // 添加到缓存
            snapshotCache.set(url, { data: result, timestamp: Date.now() });
            return result;
        }
        catch (error) {
            console.error('网页快照失败:', error);
            // 生成简化的错误占位符
            const errorSvg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8f9fa"/>
        <rect x="20" y="20" width="760" height="360" fill="#fff" stroke="#ddd" rx="4"/>
        <circle cx="400" cy="150" r="30" fill="#dc3545"/>
        <text x="400" y="160" text-anchor="middle" fill="white" font-family="Arial" font-size="20" font-weight="bold">!</text>
        <text x="400" y="220" text-anchor="middle" font-family="Arial" font-size="16" font-weight="bold" fill="#333">网页快照生成失败</text>
        <text x="400" y="250" text-anchor="middle" font-family="Arial" font-size="12" fill="#666">无法访问该网页</text>
        <text x="400" y="280" text-anchor="middle" font-family="Arial" font-size="10" fill="#999">${url}</text>
        <text x="400" y="320" text-anchor="middle" font-family="Arial" font-size="10" fill="#999">${new Date().toLocaleTimeString()}</text>
      </svg>`;
            return {
                screenshot: `data:image/svg+xml;base64,${Buffer.from(errorSvg).toString('base64')}`,
                url,
                error: 'Screenshot generation failed',
                message: error instanceof Error ? error.message : String(error)
            };
        }
    });
    // 批量创建分类RSS
    app.post('/webpage-categories-rss', async (req, reply) => {
        const schema = z.object({
            url: z.string().url(),
            categories: z.array(z.object({
                name: z.string(),
                articles: z.array(z.object({
                    title: z.string(),
                    link: z.string(),
                    pubDate: z.string()
                }))
            }))
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid payload' });
        const userId = req.user?.sub;
        const { url, categories } = parsed.data;
        console.log('Received categories:', JSON.stringify(categories, null, 2));
        try {
            const createdFeeds = [];
            for (const category of categories) {
                console.log(`Processing category: ${category.name}, articles count: ${category.articles?.length || 0}`);
                if (category.articles && category.articles.length > 0) {
                    // 创建RSS订阅源
                    const feed = await prisma.feed.create({
                        data: {
                            title: category.name,
                            url: url,
                            userId: userId,
                            groupId: null
                        }
                    });
                    // 创建文章条目
                    let successCount = 0;
                    for (const article of category.articles) {
                        try {
                            await prisma.item.create({
                                data: {
                                    title: article.title,
                                    link: article.link,
                                    published: new Date(article.pubDate),
                                    feedId: feed.id
                                }
                            });
                            successCount++;
                        }
                        catch (itemError) {
                            console.error(`Failed to create item: ${article.title}`, itemError);
                        }
                    }
                    if (successCount > 0) {
                        createdFeeds.push({
                            id: feed.id,
                            title: feed.title,
                            articlesCount: successCount
                        });
                    }
                    else {
                        await prisma.feed.delete({ where: { id: feed.id } });
                        console.error(`分类 "${category.name}" 没有成功创建任何文章`);
                    }
                }
            }
            return { feeds: createdFeeds };
        }
        catch (error) {
            console.error('批量创建RSS失败:', error);
            return reply.code(500).send({
                error: 'Failed to create RSS feeds',
                message: '批量创建RSS失败'
            });
        }
    });
    // 新增：网页词条分段（供前端“拖入”使用）
    app.post('/webpage-segmentation', async (req, reply) => {
        const schema = z.object({
            url: z.string().url(),
            mode: z.enum(['auto', 'headings', 'cluster', 'pattern']).optional().default('auto')
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid url or mode' });
        const { url, mode } = parsed.data;
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
            });
            if (!response.ok)
                return reply.code(400).send({ error: 'Failed to fetch webpage' });
            // 检测编码并解码
            const contentType = response.headers.get('content-type') || '';
            const buffer = await response.arrayBuffer();
            let html;
            if (/charset=gbk|charset=gb2312/i.test(contentType)) {
                html = iconv.decode(Buffer.from(buffer), 'gbk');
            }
            else {
                html = new TextDecoder('utf-8').decode(buffer);
            }
            let groups = [];
            let suggestedTitle = '';
            if (mode === 'auto') {
                // 自动模式：尝试所有策略，选择最佳结果
                const [headingsResult, clusterResult, patternResult] = await Promise.allSettled([
                    segmentByHeadings(url, html),
                    segmentByClusters(url, html),
                    segmentByPathPatterns(url, html)
                ]);
                const allGroups = [];
                if (headingsResult.status === 'fulfilled')
                    allGroups.push(...headingsResult.value);
                if (clusterResult.status === 'fulfilled')
                    allGroups.push(...clusterResult.value);
                if (patternResult.status === 'fulfilled')
                    allGroups.push(...patternResult.value);
                // 去重并合并相似组
                groups = mergeSimilarGroups(allGroups);
                suggestedTitle = extractSuggestedTitle(html, url);
            }
            else if (mode === 'headings') {
                groups = segmentByHeadings(url, html);
                suggestedTitle = extractSuggestedTitle(html, url);
            }
            else if (mode === 'cluster') {
                groups = segmentByClusters(url, html);
                suggestedTitle = extractSuggestedTitle(html, url);
            }
            else if (mode === 'pattern') {
                groups = segmentByPathPatterns(url, html);
                suggestedTitle = extractSuggestedTitle(html, url);
            }
            // 如果静态解析失败，尝试Puppeteer快照
            if (groups.length === 0) {
                try {
                    const snapshotHtml = await getSnapshotHtml(url);
                    if (snapshotHtml) {
                        if (mode === 'auto' || mode === 'headings') {
                            groups = segmentByHeadings(url, snapshotHtml);
                        }
                        else if (mode === 'cluster') {
                            groups = segmentByClusters(url, snapshotHtml);
                        }
                        else if (mode === 'pattern') {
                            groups = segmentByPathPatterns(url, snapshotHtml);
                        }
                    }
                }
                catch (e) {
                    console.log('Puppeteer fallback failed:', e);
                }
            }
            // 格式化输出
            const payload = groups.map(g => ({
                titleToken: g.titleToken || g.heading,
                contentTokensPreview: g.articles[0]?.title || '',
                articles: g.articles.slice(0, 50) // 限制每组最多50篇文章
            })).slice(0, 15);
            return {
                groups: payload,
                suggestedTitle,
                mode,
                totalGroups: groups.length
            };
        }
        catch (e) {
            console.error('Segmentation error:', e);
            return reply.code(500).send({ error: 'Segmentation failed' });
        }
    });
    // 新增：根据用户选择生成RSS订阅源
    app.post('/webpage-build-rss', async (req, reply) => {
        const schema = z.object({
            userId: z.string().optional(),
            url: z.string().url(),
            titleToken: z.string(),
            articles: z.array(z.object({ title: z.string(), link: z.string(), pubDate: z.string().optional() }))
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Invalid payload' });
        const { userId, url, titleToken, articles } = parsed.data;
        const actualUserId = userId || req.user?.sub;
        try {
            const host = new URL(url).hostname;
            const safeTitle = titleToken.replace(/[\n\r\t]+/g, ' ').slice(0, 180);
            // 校验用户是否存在（防止旧 token 指向已不存在的用户导致外键错误）
            if (!actualUserId) {
                return reply.code(401).send({ error: 'Invalid user', message: '用户ID不能为空' });
            }
            const userExists = await prisma.user.findUnique({ where: { id: actualUserId } });
            if (!userExists) {
                return reply.code(401).send({ error: 'Invalid user', message: '用户不存在或登录已过期，请重新登录' });
            }
            // 过滤无效/跨域/重复链接
            const seen = new Set();
            const filtered = articles
                .map(a => {
                try {
                    const u = new URL(a.link);
                    return { ...a, link: u.href };
                }
                catch {
                    return null;
                }
            })
                .filter(Boolean)
                .filter((a) => {
                try {
                    return new URL(a.link).hostname === host;
                }
                catch {
                    return false;
                }
            })
                .filter((a) => {
                if (seen.has(a.link))
                    return false;
                seen.add(a.link);
                return true;
            })
                .slice(0, 50);
            if (filtered.length === 0) {
                return reply.code(400).send({ error: 'No valid articles', message: '未找到有效的文章链接（需要与站点同域且为有效URL）' });
            }
            const feed = await prisma.feed.create({
                data: { title: safeTitle, url, userId: actualUserId, groupId: null }
            });
            let created = 0;
            for (const a of filtered) {
                try {
                    await prisma.item.create({
                        data: {
                            title: a.title?.slice(0, 300) || '无标题',
                            link: a.link,
                            published: a.pubDate ? new Date(a.pubDate) : new Date(),
                            feedId: feed.id
                        }
                    });
                    created++;
                }
                catch (err) {
                    // 跳过个别失败，不中断
                }
            }
            return { id: feed.id, title: feed.title, articlesCount: created };
        }
        catch (e) {
            const msg = e?.message || 'unknown error';
            return reply.code(500).send({ error: 'Failed to build rss', message: msg });
        }
    });
}
//# sourceMappingURL=routes.js.map