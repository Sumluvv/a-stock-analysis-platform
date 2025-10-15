import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import Parser from 'rss-parser';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import * as iconv from 'iconv-lite';

const prisma = new PrismaClient();
const parser = new Parser();

// 实时更新机制
let updateInterval: NodeJS.Timeout | null = null;

// 更新RSS订阅源
async function updateRSSFeeds() {
  try {
    const feeds = await prisma.feed.findMany({
      include: { items: true }
    });

    for (const feed of feeds) {
      try {
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
      } catch (error) {
        console.error(`更新RSS失败 ${feed.title}:`, error);
      }
    }
  } catch (error) {
    console.error('RSS更新任务失败:', error);
  }
}

// 更新网页RSS订阅源
async function updateWebpageFeeds() {
  try {
    const feeds = await prisma.feed.findMany({});

    for (const feed of feeds) {
      try {
        // 重新检测网页分类和文章
        const response = await fetch(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          },
          timeout: 30000
        });
        
        if (response.ok) {
          const html = await response.text();
          const $ = cheerio.load(html);
          
          // 删除过期文章（超过30天）
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          
          await prisma.item.deleteMany({
            where: {
              feedId: feed.id,
              published: { lt: thirtyDaysAgo }
            }
          });
          
          // 检测新文章
          const governmentCategories = [
            '规范性文件', '政策解读', '通知公告', '要闻', '最新政策', '政策文件',
            '法规制度', '管理办法', '实施细则', '工作动态', '新闻动态'
          ];
          
          const selectors = ['a', '.news-item a', '.article-item a', '.policy-item a'];
          const newArticles = [];
          
          for (const selector of selectors) {
            $(selector).each((_, element) => {
              const text = $(element).text().trim();
              const href = $(element).attr('href');
              
              if (text && href && text.length > 5 && text.length < 100) {
                const isRelevant = governmentCategories.some(keyword => 
                  text.includes(keyword)
                ) || text.includes('通知') || text.includes('公告') || text.includes('政策');
                
                if (isRelevant) {
                  const fullUrl = href.startsWith('http') ? href : new URL(href, feed.url).href;
                  newArticles.push({
                    title: text,
                    link: fullUrl,
                    pubDate: new Date()
                  });
                }
              }
            });
          }
          
          // 添加新文章
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
                  published: article.pubDate,
                  feedId: feed.id
                }
              });
            }
          }
        }
      } catch (error) {
        console.error(`更新网页RSS失败 ${feed.title}:`, error);
      }
    }
  } catch (error) {
    console.error('网页RSS更新任务失败:', error);
  }
}

// 启动定时更新任务
function startUpdateTasks() {
  // RSS每10秒更新一次
  updateInterval = setInterval(updateRSSFeeds, 10 * 1000);
  
  // 网页RSS每20分钟更新一次
  setInterval(updateWebpageFeeds, 20 * 60 * 1000);
  
  console.log('实时更新任务已启动: RSS每10秒, 网页RSS每20分钟');
}

// 停止更新任务
function stopUpdateTasks() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

export async function feedRoutes(app: FastifyInstance) {
  // 启动实时更新任务
  startUpdateTasks();
  
  app.addHook('onRequest', async (req, reply) => {
    try {
      await (req as any).jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/', async (req, reply) => {
    const userId = (req as any).user?.sub as string;
    const feeds = await prisma.feed.findMany({ 
      where: { userId },
      include: { group: true },
      orderBy: { createdAt: 'desc' }
    });
    return { feeds };
  });

  app.get('/groups', async (req, reply) => {
    const userId = (req as any).user?.sub as string;
    const groups = await prisma.group.findMany({ 
      where: { userId },
      include: { feeds: true },
      orderBy: { createdAt: 'asc' }
    });
    return { groups };
  });

  app.post('/import', async (req, reply) => {
    const schema = z.object({ url: z.string().url() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid url' });

    const userId = (req as any).user?.sub as string;

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
    } catch (error) {
      console.error('RSS Import Error:', error);
      
      let errorMessage = 'Unknown error';
      let suggestion = '请检查RSS链接是否正确';
      
      if (error instanceof Error) {
        const message = error.message;
        
        // 分析具体错误类型
        if (message.includes('Status code 404')) {
          errorMessage = 'RSS链接不存在 (404)';
          suggestion = '该RSS链接可能已失效，请检查链接是否正确或联系网站管理员';
        } else if (message.includes('Status code 504') || message.includes('Gateway Time-out')) {
          errorMessage = '服务器响应超时 (504)';
          suggestion = '服务器暂时无法响应，请稍后重试或检查网络连接';
        } else if (message.includes('Status code 403')) {
          errorMessage = '访问被拒绝 (403)';
          suggestion = '该RSS链接可能需要特殊权限访问，请检查是否需要登录';
        } else if (message.includes('Status code 500')) {
          errorMessage = '服务器内部错误 (500)';
          suggestion = 'RSS服务器出现问题，请稍后重试';
        } else if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
          errorMessage = '域名无法解析';
          suggestion = '网站域名可能已失效或不存在，请检查链接是否正确';
        } else if (message.includes('ECONNREFUSED')) {
          errorMessage = '连接被拒绝';
          suggestion = '无法连接到RSS服务器，请检查网络连接';
        } else if (message.includes('timeout')) {
          errorMessage = '连接超时';
          suggestion = '网络连接超时，请检查网络状况后重试';
        } else if (message.includes('Invalid XML') || message.includes('XML parsing')) {
          errorMessage = 'RSS格式错误';
          suggestion = '该链接不是有效的RSS格式，请确认链接是否正确';
        } else {
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
    const { id } = req.params as { id: string };
    const items = await prisma.item.findMany({ where: { feedId: id }, orderBy: { published: 'desc' } });
    return { items };
  });

  // 删除订阅源
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = (req as any).user?.sub as string;
    
    try {
      // 先删除相关的文章
      await prisma.item.deleteMany({ where: { feedId: id } });
      // 再删除订阅源
      await prisma.feed.delete({ where: { id, userId } });
      return { success: true };
    } catch (error) {
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
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

    const userId = (req as any).user?.sub as string;
    const { name, color } = parsed.data;

    try {
      const group = await prisma.group.create({
        data: { userId, name, color: color || '#3b82f6' }
      });
      return group;
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to create group' });
    }
  });

  // 更新订阅源分组
  app.patch('/:id/group', async (req, reply) => {
    const { id } = req.params as { id: string };
    const schema = z.object({ groupId: z.string().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

    const userId = (req as any).user?.sub as string;
    const { groupId } = parsed.data;

    try {
      const feed = await prisma.feed.update({
        where: { id, userId },
        data: { groupId }
      });
      return feed;
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to update feed group' });
    }
  });

  // 获取分组的所有文章
  app.get('/groups/:groupId/items', async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const userId = (req as any).user?.sub as string;

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
    } catch (error) {
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
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

    const { url, selectors } = parsed.data;
    const userId = (req as any).user?.sub as string;

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
          const title = element.textContent?.trim() || '';
          const link = element.closest('a')?.href || '';
          
          // 尝试找到对应的内容
          const contentEl = element.closest('*')?.querySelector(sel.content);
          const content = contentEl?.textContent?.trim() || '';
          
          // 尝试找到时间
          const timeEl = element.closest('*')?.querySelector(sel.time);
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
          title: `网页抓取: ${new URL(url).hostname}` 
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
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to scrape webpage' });
    }
  });

  // 获取网页预览（用于选择器测试）
  app.post('/webpage-preview', async (req, reply) => {
    const schema = z.object({ url: z.string().url() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid url' });

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
          .map(a => ({ text: a.textContent?.trim(), href: a.href }));
        
        return { title, headings, links };
      });

      await browser.close();
      return pageInfo;
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to preview webpage' });
    }
  });

  // 删除分组
  app.delete('/groups/:groupId', async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const userId = (req as any).user?.sub as string;
    
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
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to delete group' });                             
    }
  });

  // 网页转RSS - 智能分类检测
  app.post('/webpage-categories', async (req, reply) => {
    const schema = z.object({ url: z.string().url() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid url' });

    const { url } = parsed.data;
    
    try {
      // 首先尝试使用cheerio快速解析静态内容
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 30000
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
        const siteCategories: Array<{ name: string; hrefCandidates: string[] }> = [
          { name: '规范性文件', hrefCandidates: ['规范性文件', '/gfxwj', '/zcfg/gfxwj'] },
          { name: '政策解读', hrefCandidates: ['政策解读', '/zcjd'] },
          { name: '通知公告', hrefCandidates: ['通知公告', '/tzgg'] },
          { name: '事业单位公开招聘', hrefCandidates: ['事业单位公开招聘', '公开招聘'] }
        ];

        async function fetchListPage(listUrl: string) {
          try {
            const res = await fetch(listUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              },
              timeout: 20000
            });
            if (!res.ok) return [] as any[];
            const html2 = await res.text();
            const $$ = cheerio.load(html2);
            const articles: any[] = [];
            // 常见列表结构：ul li a, .list a, .news-list a
            $$(
              'ul li a, .list a, .news-list a, .article-list a, .info-list a'
            ).each((_, a) => {
              const text = $$(a).text().trim();
              const href = $$(a).attr('href');
              if (!href || !text || text.length < 5) return;
              // 过滤外部站点导航类链接
              if (/gov\.cn|gd\.gov\.cn|mohrss\.gov\.cn|rsj\.|rst\./i.test(href)) return;
              const fullUrl = href.startsWith('http') ? href : new URL(href, listUrl).href;
              // 过滤导航/面包屑等非文章链接
              if (/首页|上一页|下一页|更多|返回/.test(text)) return;
              articles.push({ title: text, link: fullUrl, pubDate: new Date().toISOString() });
            });
            return articles.slice(0, 15);
          } catch {
            return [] as any[];
          }
        }

        const categories: any[] = [];
        for (const cfg of siteCategories) {
          // 在首页内寻找相关入口链接
          let candidateHref: string | null = null;
          $('a').each((_, a) => {
            const text = $(a).text().trim();
            const href = $(a).attr('href') || '';
            if (candidateHref) return;
            const matchedByText = cfg.hrefCandidates.some(k => text.includes(k));
            const matchedByPath = cfg.hrefCandidates.some(k => k.startsWith('/') && href.includes(k));
            if ((matchedByText || matchedByPath) && href) {
              candidateHref = href.startsWith('http') ? href : new URL(href, url).href;
            }
          });

          // 如果首页没找到，尝试根据已知路径猜测一个列表入口
          if (!candidateHref) {
            const guesses = cfg.hrefCandidates.filter(k => k.startsWith('/'));
            if (guesses.length > 0) {
              candidateHref = new URL(guesses[0], url).href;
            }
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
      
      // 政府网站常见分类关键词
      const governmentCategories = [
        '规范性文件', '政策解读', '通知公告', '要闻', '最新政策', '政策文件',
        '法规制度', '管理办法', '实施细则', '工作动态', '新闻动态',
        '重要通知', '公告公示', '政策法规', '办事指南', '信息公开'
      ];
      
      // 智能检测分类
      const categories = [];
      const processedSelectors = new Set();
      
      // 检测导航菜单、侧边栏、内容区域中的分类
      const selectors = [
        'nav a', '.nav a', '.menu a', '.sidebar a', '.category a',
        '.content h2', '.content h3', '.news-list h3', '.article-list h3',
        '.policy-list h3', '.notice-list h3', '.file-list h3',
        'ul li a', 'ol li a', '.list-item a', '.item-title'
      ];
      
      for (const selector of selectors) {
        $(selector).each((_, element) => {
          const text = $(element).text().trim();
          const href = $(element).attr('href');
          
          if (text && text.length > 2 && text.length < 50 && href) {
            // 检查是否包含政府网站关键词
            const isGovernmentCategory = governmentCategories.some(keyword => 
              text.includes(keyword)
            );
            
            if (isGovernmentCategory && !processedSelectors.has(text)) {
              processedSelectors.add(text);
              
              // 尝试找到对应的文章列表
              const articles = [];
              const parent = $(element).closest('ul, ol, div, section');
              
              if (parent.length > 0) {
                parent.find('a').each((_, linkEl) => {
                  const linkText = $(linkEl).text().trim();
                  const linkHref = $(linkEl).attr('href');
                  
                  if (linkText && linkHref && linkText !== text) {
                    // 构建完整URL
                    const fullUrl = linkHref.startsWith('http') ? linkHref : new URL(linkHref, url).href;
                    
                    articles.push({
                      title: linkText,
                      link: fullUrl,
                      pubDate: new Date().toISOString()
                    });
                  }
                });
              }
              
              categories.push({
                name: text,
                selector: selector,
                articles: articles.slice(0, 10) // 限制文章数量
              });
            }
          }
        });
      }
      
      // 如果没有检测到分类，尝试通用检测
      if (categories.length === 0) {
        $('a').each((_, element) => {
          const text = $(element).text().trim();
          const href = $(element).attr('href');
          
          if (text && text.length > 3 && text.length < 30 && href && 
              !text.includes('首页') && !text.includes('关于') && 
              !text.includes('联系') && !text.includes('登录')) {
            
            if (!processedSelectors.has(text)) {
              processedSelectors.add(text);
              
              categories.push({
                name: text,
                selector: 'a',
                articles: []
              });
            }
          }
        });
      }
      
      return { categories: categories.slice(0, 8) }; // 限制分类数量
      
    } catch (error) {
      console.error('网页分类检测失败:', error);
      return reply.code(500).send({ 
        error: 'Failed to detect categories',
        message: '网页分类检测失败，请检查URL是否正确'
      });
    }
  });

  // 网页快照功能
  app.post('/webpage-snapshot', async (req, reply) => {
    const schema = z.object({ url: z.string().url() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid url' });

    const { url } = parsed.data;
    
    try {
      // 增强稳定性：重试 2 次，不同等待策略
      const maxAttempts = 2;
      let lastError: any = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--window-size=1920,1080'
            ]
          });

          const page = await browser.newPage();
          await page.setViewport({ width: 1920, height: 1080 });
          await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

          await page.goto(url, {
            // 第一次快速：domcontentloaded；若失败再用 networkidle2
            waitUntil: attempt === 1 ? 'domcontentloaded' : 'networkidle2',
            timeout: 45000
          });

          // 滚动以触发懒加载
          await page.evaluate(async () => {
            const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
            for (let y = 0; y < 2000; y += 400) {
              window.scrollTo(0, y);
              await delay(200);
            }
            window.scrollTo(0, 0);
          });
          await new Promise(r => setTimeout(r, attempt === 1 ? 1500 : 2500));

          const screenshot = await page.screenshot({
            fullPage: true,
            type: 'jpeg',
            quality: 85
          });
          await browser.close();

          return {
            screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
            url
          };
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError;
    } catch (error) {
      console.error('网页快照失败:', error);
      // 返回SVG占位符
      const svgPlaceholder = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f3f4f6"/>
        <text x="50%" y="50%" text-anchor="middle" fill="#6b7280" font-family="Arial, sans-serif" font-size="16">
          网页快照生成失败
        </text>
      </svg>`;
      
      return { 
        screenshot: `data:image/svg+xml;base64,${Buffer.from(svgPlaceholder).toString('base64')}`,
        url: url,
        error: 'Screenshot generation failed'
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
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

    const userId = (req as any).user?.sub as string;
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
              title: `${new URL(url).hostname}/${category.name}`,
              url: url,
              type: 'webpage',
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
            } catch (itemError) {
              console.error(`Failed to create item: ${article.title}`, itemError);
            }
          }
          
          if (successCount > 0) {
            createdFeeds.push({
              id: feed.id,
              title: feed.title,
              articlesCount: successCount
            });
          } else {
            await prisma.feed.delete({ where: { id: feed.id } });
            console.error(`分类 "${category.name}" 没有成功创建任何文章`);
          }
        }
      }
      
      return { feeds: createdFeeds };
      
    } catch (error) {
      console.error('批量创建RSS失败:', error);
      return reply.code(500).send({ 
        error: 'Failed to create RSS feeds',
        message: '批量创建RSS失败'
      });
    }
  });

  // 网页快照功能
  app.post('/webpage-snapshot', async (req, reply) => {
    const schema = z.object({ url: z.string().url() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid url' });

    const { url } = parsed.data;
    
    let browser;
    try {
      // 优化为快速预览模式
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-images', // 禁用图片加载以加快速度
          '--disable-javascript', // 禁用JS以加快速度
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--window-size=1200,800' // 减小窗口尺寸
        ]
      });

      const page = await browser.newPage();
      
      // 设置更短的超时时间
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(5000);
      
      await page.setViewport({ width: 1200, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // 快速导航，只等待DOM加载完成
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 5000 // 进一步减少超时时间
      });

      // 简单等待，不进行复杂滚动
      await page.waitForTimeout(200);

      // 只截取可见区域，不截取全页面
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 60, // 进一步降低质量
        clip: { x: 0, y: 0, width: 1200, height: 800 } // 只截取可见区域
      });
      
      await browser.close();

      return {
        screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
        url
      };
    } catch (error) {
      console.error('网页快照失败:', error);
      if (browser) {
        try { await browser.close(); } catch {}
      }
      // 返回SVG占位符
      const svgPlaceholder = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f3f4f6"/>
        <text x="50%" y="50%" text-anchor="middle" fill="#6b7280" font-family="Arial, sans-serif" font-size="16">
          网页快照生成失败
        </text>
      </svg>`;
      
      return { 
        screenshot: `data:image/svg+xml;base64,${Buffer.from(svgPlaceholder).toString('base64')}`,
        url: url,
        error: 'Screenshot generation failed'
      };
    }
  });

  // 根据用户选择生成RSS订阅源
  app.post('/webpage-build-rss', async (req, reply) => {
    const schema = z.object({
      url: z.string().url(),
      titleToken: z.string(),
      articles: z.array(z.object({ title: z.string(), link: z.string(), pubDate: z.string().optional() }))
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });

    const userId = (req as any).user?.sub as string;
    const { url, titleToken, articles } = parsed.data;
    
    try {
      const host = new URL(url).hostname;
      const safeTitle = `${host}/${titleToken}`.replace(/[\n\r\t]+/g, ' ').slice(0, 180);

      // 校验用户是否存在
      const userExists = await prisma.user.findUnique({ where: { id: userId } });
      if (!userExists) {
        return reply.code(401).send({ error: 'Invalid user', message: '用户不存在或登录已过期，请重新登录' });
      }

      // 过滤无效/跨域/重复链接
      const seen = new Set<string>();
      const filtered = articles
        .map(a => {
          try {
            const u = new URL(a.link);
            return { ...a, link: u.href };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter((a: any) => {
          try {
            return new URL(a.link).hostname === host;
          } catch { return false; }
        })
        .filter((a: any) => {
          if (seen.has(a.link)) return false;
          seen.add(a.link);
          return true;
        })
        .slice(0, 50) as Array<{ title: string; link: string; pubDate?: string }>;

      if (filtered.length === 0) {
        return reply.code(400).send({ error: 'No valid articles', message: '未找到有效的文章链接（需要与站点同域且为有效URL）' });
      }

      const feed = await prisma.feed.create({
        data: { title: safeTitle, url, userId, groupId: null }
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
        } catch (err) {
          // 跳过个别失败，不中断
        }
      }
      return { id: feed.id, title: feed.title, articlesCount: created };
    } catch (e: any) {
      const msg = e?.message || 'unknown error';
      return reply.code(500).send({ error: 'Failed to build rss', message: msg });
    }
  });

  // 网页分段功能
  app.post('/webpage-segmentation', async (req, reply) => {
    const schema = z.object({ 
      url: z.string().url(), 
      mode: z.enum(['auto','headings','cluster','pattern']).optional() 
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid url' });

    const { url, mode = 'auto' } = parsed.data;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 25000
      });
      
      if (!response.ok) return reply.code(400).send({ error: 'Failed to fetch webpage' });
      
      // 编码处理
      const ct = response.headers.get('content-type') || '';
      const buf = Buffer.from(await response.arrayBuffer());
      let charset = 'utf-8';
      if (/charset=([^;]+)/i.test(ct)) {
        const m = ct.match(/charset=([^;]+)/i);
        if (m) charset = m[1].toLowerCase();
      } else {
        const head = buf.slice(0, 2048).toString('ascii');
        const m2 = head.match(/charset\s*=\s*([a-zA-Z0-9-]+)/i);
        if (m2) charset = m2[1].toLowerCase();
      }
      
      if (charset.includes('gbk') || charset.includes('gb2312')) {
        if (!iconv.encodingExists('gbk')) charset = 'utf-8';
      }
      
      const html = (charset.includes('gbk') || charset.includes('gb2312'))
        ? iconv.decode(buf, 'gbk')
        : buf.toString('utf-8');
      
      let groups: Array<{ heading: string; articles: any[] }> = [];
      
      // 提取建议标题
      const $meta = cheerio.load(html);
      function extractSuggestedTitle(): string | null {
        try {
          const textSel = $meta('*').filter((_, e) => /当前位置/.test($meta(e).text())).first();
          if (textSel && textSel.length) {
            const html = $meta(textSel).html() || '';
            const match = html.match(/当前位置[:：]\s*(.+)/);
            if (match) {
              const breadcrumbHtml = match[1];
              const linkTexts: string[] = [];
              const $breadcrumb = cheerio.load(breadcrumbHtml);
              $breadcrumb('a').each((_, a) => {
                const text = $breadcrumb(a).text().trim();
                if (text) linkTexts.push(text);
              });
              if (linkTexts.length === 0) {
                const cleanText = breadcrumbHtml
                  .replace(/<[^>]+>/g, '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&gt;/g, '>')
                  .replace(/&lt;/g, '<')
                  .replace(/\s+/g, ' ')
                  .trim();
                const tokens = cleanText.split(/[>＞]/).map(s=>s.trim()).filter(Boolean);
                const cleaned = tokens.filter(p => !/^首页$/.test(p) && p.length <= 20);
                if (cleaned.length) return cleaned[cleaned.length - 1];
              } else {
                const cleaned = linkTexts.filter(p => !/^首页$/.test(p) && p.length <= 20);
                if (cleaned.length) return cleaned[cleaned.length - 1];
              }
            }
          }
          
          const candidates = [
            '.breadcrumb', 'nav.breadcrumb', '.crumb', '.breadcrumbs', '.position', '.sitepath', '.path', '.m-crumb', '.location', '.loc'
          ];
          for (const sel of candidates) {
            const el = $meta(sel).first();
            if (el && el.length) {
              const parts: string[] = [];
              el.find('a, span, li').each((_, x) => {
                const t = $meta(x).text().trim();
                if (t) parts.push(t);
              });
              const cleaned = parts.filter(p => !/^首页$/.test(p) && p.length <= 20);
              if (cleaned.length) return cleaned[cleaned.length - 1];
            }
          }
          
          $meta('*').each((_, el) => {
            const text = $meta(el).text().trim();
            if (text.includes('>') || text.includes('＞')) {
              const tokens = text.split(/[>＞]/).map(s=>s.trim()).filter(Boolean);
              const cleaned = tokens.filter(p => !/^首页$/.test(p) && p.length <= 20);
              if (cleaned.length >= 2) return cleaned[cleaned.length - 1];
            }
          });
          
        } catch {}
        
        try {
          const title = $meta('title').first().text().trim();
          if (title) return title.slice(0, 30);
        } catch {}
        return null;
      }
      
      const suggestedTitle = extractSuggestedTitle();
      
      // 分段策略
      const runHeadings = () => segmentByHeadings(url, html);
      const runCluster = () => segmentByClusters(url, html);
      const runPattern = () => segmentByPathPatterns(url, html);

      if (mode === 'headings') groups = runHeadings();
      else if (mode === 'cluster') groups = runCluster();
      else if (mode === 'pattern') groups = runPattern();
      else {
        // auto模式：多策略合并
        const a = runHeadings();
        const b = runCluster();
        const c = runPattern();
        groups = [...a, ...b, ...c]
          .sort((x,y)=> (y.articles?.length||0) - (x.articles?.length||0))
          .filter((g,idx,self)=> self.findIndex(s=>s.heading===g.heading)===idx)
          .slice(0,12);
        if (!groups.length) groups = b.length ? b : c;
      }
      
      const payload = groups.map(g => ({
        titleToken: g.heading,
        contentTokensPreview: g.articles[0]?.title || '',
        articles: g.articles
      })).slice(0, 15);
      
      return { groups: payload, suggestedTitle };
    } catch (e) {
      return reply.code(500).send({ error: 'Segmentation failed' });
    }
  });
}

// 基于标题分组的通用分段函数
function segmentByHeadings(url: string, html: string) {
  const $ = cheerio.load(html);
  const hostname = new URL(url).hostname;

  function isSameHost(href: string) {
    try {
      const u = new URL(href, url);
      return u.hostname === hostname;
    } catch {
      return false;
    }
  }

  function normalizeUrl(href: string) {
    try {
      return new URL(href, url).href;
    } catch {
      return '';
    }
  }

  const headingSelectors = 'h1, h2, h3';
  const groups: Array<{ heading: string; articles: Array<{ title: string; link: string; pubDate: string }> }> = [];

  // 站点与栏目定向规则
  const isRecruitListPage = /hrss\.gd\.gov\.cn/.test(hostname) && /\/zwgk\/sydwzp\//.test(url);
  const blacklistHeadingRegex = /(上级政府网站|各省市人社部门网站|各地市人社部门网站|业务网站|友情链接|网站地图|联系我们)/;
  const recruitKeywordRegex = /(公告|公示|招聘|拟聘|集中公开招聘|高校毕业生)/;
  const dateRegex = /(20\d{2}[\-\.年]\s*\d{1,2}([\-\.月]\s*\d{1,2})?|20\d{2}\s*年\s*\d{1,2}\s*月)/;

  function isLikelyArticle(text: string, linkHref: string, contextHeading: string): boolean {
    if (!text) return false;
    if (blacklistHeadingRegex.test(contextHeading)) return false;
    if (text.length < 2) return false; // 降低最小长度要求
    
    // 过滤明显的导航和页脚链接（更严格的匹配）
    const navKeywords = /^(联系我们|交通指引|版权说明|网址域名|隐私保护|法律责任|网站地图|回到顶部|首页|上一页|下一页|更多|返回|登录|注册)$/;
    if (navKeywords.test(text)) return false;
    
    // 过滤标题词条（这些不应该作为文章出现）
    const titleKeywords = /^(政务公开|通知公告|政策解读|规范性文件|信息公开|工作动态|新闻中心|公告公示)$/;
    if (titleKeywords.test(text)) return false;
    
    // 过滤分页数字和导航
    if (/^(第一页|最后一页|\d+页?)$/.test(text)) return false;
    
    // 过滤纯数字或纯符号
    if (/^[\d\s\-\.]+$/.test(text)) return false;
    
    // 对于招聘页面，放宽关键词要求
    if (isRecruitListPage) {
      const excludeKeywords = /^(首页|上一页|下一页|更多|返回|登录|注册|联系我们|交通指引|版权说明)$/;
      if (excludeKeywords.test(text)) return false;
      return true;
    }
    
    // 对于其他页面，只要不是明显的导航词，就认为是文章
    const excludeKeywords = /^(首页|上一页|下一页|更多|返回|登录|注册|联系我们|交通指引|版权说明|网站地图|回到顶部)$/;
    if (excludeKeywords.test(text)) return false;
    
    return true;
  }

  $(headingSelectors).each((_, h) => {
    const name = $(h).text().trim();
    if (!name || name.length < 2 || name.length > 30) return;
    if (/^首页$|关于|登录|联系我们/.test(name)) return;
    if (blacklistHeadingRegex.test(name)) return;

    const currentLevel = parseInt((h.tagName || 'h3').replace(/[^0-9]/g, '')) || 3;
    const articles: any[] = [];
    let walker = $(h).next();
    let steps = 0;
    while (walker.length && steps < 25) {
      const tag = walker.get(0)?.tagName?.toLowerCase() || '';
      if (/^h[1-3]$/.test(tag)) {
        const level = parseInt(tag.replace('h', '')) || 3;
        if (level <= currentLevel) break;
      }
      walker.find('a[href]').each((__, a) => {
        const text = $(a).text().trim();
        const href = $(a).attr('href') || '';
        if (!text || !href) return;
        if (text.length < 2 || text.length > 200) return; // 放宽长度限制
        if (/首页|上一页|下一页|更多|返回/.test(text)) return;
        const full = normalizeUrl(href);
        if (!full || !isSameHost(full)) return;
        if (!isLikelyArticle(text, full, name)) return;
        // 附加日期判定
        let hasDate = dateRegex.test(text);
        if (!hasDate) {
          const near = $(a).parent().text();
          hasDate = dateRegex.test(near);
        }
        // 对于招聘栏目，优先保留有日期的项
        if (isRecruitListPage && !hasDate) return;
        articles.push({ title: text.replace(/\s+/g, ' '), link: full, pubDate: new Date().toISOString() });
      });
      walker = walker.next();
      steps++;
    }
    const seen = new Set<string>();
    const unique = articles.filter(a => {
      if (seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    }).slice(0, 30);
    if (unique.length >= 2) groups.push({ heading: name, articles: unique });
  });

  // 站点特例兜底
  if (groups.length === 0 && isRecruitListPage) {
    const fallbackArticles: Array<{ title: string; link: string; pubDate: string }> = [];
    $('ul li a, .list a, .news-list a, .article-list a, .info-list a, a').each((_, a) => {
      const text = $(a).text().trim();
      const href = $(a).attr('href') || '';
      if (!text || !href) return;
      if (/首页|上一页|下一页|更多|返回/.test(text)) return;
      if (text.length < 5 || text.length > 120) return;
      const full = normalizeUrl(href);
      if (!full || !isSameHost(full)) return;
      try {
        const p = new URL(full).pathname;
        if (!/\/zwgk\/sydwzp\//.test(p)) return;
      } catch {}
      const hasDate = dateRegex.test(text) || dateRegex.test($(a).parent().text());
      if (!hasDate) return;
      if (!isLikelyArticle(text, full, '事业单位公开招聘')) return;
      fallbackArticles.push({ title: text.replace(/\s+/g, ' '), link: full, pubDate: new Date().toISOString() });
    });
    const seen2 = new Set<string>();
    const uniq2 = fallbackArticles.filter(a => {
      if (seen2.has(a.link)) return false;
      seen2.add(a.link);
      return true;
    }).slice(0, 30);
    if (uniq2.length >= 2) {
      groups.push({ heading: '事业单位公开招聘', articles: uniq2 });
    }
  }

  return groups;
}

// 通用分段B：链接簇聚类
function segmentByClusters(url: string, html: string) {
  const $ = cheerio.load(html);
  const hostname = new URL(url).hostname;

  function isSameHost(href: string) {
    try {
      const u = new URL(href, url);
      return u.hostname === hostname;
    } catch { return false; }
  }
  function normalizeUrl(href: string) {
    try { return new URL(href, url).href; } catch { return ''; }
  }
  function getDomPath(el: cheerio.Element | undefined): string {
    const parts: string[] = [];
    let node: any = el;
    let steps = 0;
    while (node && node.type === 'tag' && steps < 6) {
      const tag = node.tagName || node.name || 'div';
      const cls = (node.attribs?.class || '').split(/\s+/).filter(Boolean).slice(0,2).join('.');
      parts.unshift(cls ? `${tag}.${cls}` : tag);
      node = node.parent;
      steps++;
    }
    return parts.join('>');
  }

  const clusters: Record<string, Array<{ title: string; link: string; pubDate: string }>> = {};
  $('a[href]').each((_, a) => {
    const text = $(a).text().trim();
    const href = $(a).attr('href') || '';
    if (!text || !href) return;
    if (text.length < 2 || text.length > 200) return; // 放宽长度限制
    // 过滤导航和页脚链接
    if (/(首页|上一页|下一页|更多|返回|联系我们|交通指引|版权说明|网址域名|隐私保护|法律责任|网站地图|回到顶部|登录|注册)/.test(text)) return;
    const full = normalizeUrl(href);
    if (!full || !isSameHost(full)) return;
    // 路径前缀特征
    let pathKey = '';
    try { const u = new URL(full); pathKey = u.pathname.split('/').slice(0,3).join('/'); } catch {}
    const domKey = getDomPath(a.parent as any);
    const key = `${domKey}::${pathKey}`;
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push({ title: text.replace(/\s+/g,' '), link: full, pubDate: new Date().toISOString() });
  });

  // 评分并生成分组
  const scored: Array<{ key: string; score: number; items: any[] }>=[];
  for (const [key, items] of Object.entries(clusters)) {
    const seen = new Set(items.map(i=>i.link));
    const uniq = items.filter(i=>{ if (seen.has(i.link)) return false; seen.delete(i.link); return true; });
    const dateHit = uniq.slice(0,30).filter(i=>/(20\d{2}|\d{1,2}月|\d{1,2}-\d{1,2})/.test(i.title)).length;
    const score = uniq.length + dateHit * 0.5;
    if (uniq.length >= 3) scored.push({ key, score, items: uniq.slice(0,50) });
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,8).map(s=>({ heading: s.key.split('::')[0] || '内容列表', articles: s.items }));
}

// 通用分段C：路径模式聚合
function segmentByPathPatterns(url: string, html: string) {
  const $ = cheerio.load(html);
  const hostname = new URL(url).hostname;
  function isSameHost(href: string) { try { const u=new URL(href, url); return u.hostname===hostname; } catch { return false; } }
  function normalizeUrl(href: string) { try { return new URL(href, url).href; } catch { return ''; } }

  const buckets: Record<string, Array<{ title: string; link: string; pubDate: string }>> = {};
  
  // 简化的文章识别逻辑
  $('a[href]').each((_, a) => {
    const text = $(a).text().trim();
    const href = $(a).attr('href') || '';
    if (!text || !href) return;
    
    // 过滤明显的导航和页脚链接（更严格的匹配）
    const navKeywords = /^(联系我们|交通指引|版权说明|网址域名|隐私保护|法律责任|网站地图|回到顶部|首页|上一页|下一页|更多|返回|登录|注册)$/;
    if (navKeywords.test(text)) return;
    
    // 过滤标题词条（这些不应该作为文章出现）
    if (/^(政务公开|通知公告|政策解读|规范性文件|信息公开|工作动态|新闻中心|公告公示)$/.test(text)) return;
    
    // 过滤分页数字和导航
    if (/^(第一页|最后一页|\d+页?)$/.test(text)) return;
    
    // 过滤纯数字或纯符号
    if (/^[\d\s\-\.]+$/.test(text)) return;
    
    const full = normalizeUrl(href);
    if (!full || !isSameHost(full)) return;
    try {
      const u = new URL(full);
      // 取目录前缀，生成更友好的标题
      const parts = u.pathname.split('/').filter(Boolean);
      let key = '';
      if (parts.length >= 2) {
        // 将路径转换为更友好的标题
        const dirParts = parts.slice(0, 2);
        if (dirParts[0] === 'zwgk') {
          key = '政务公开';
        } else if (dirParts[0] === 'wzdh') {
          key = '网站导航';
        } else if (dirParts[0] === 'news') {
          key = '新闻资讯';
        } else if (dirParts[0] === 'article') {
          key = '文章列表';
        } else {
          key = dirParts.join('/');
        }
      } else if (parts.length === 1) {
        key = parts[0];
      } else {
        key = '其他内容';
      }
      
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push({ title: text.replace(/\s+/g,' '), link: full, pubDate: new Date().toISOString() });
    } catch {}
  });
  
  const result: Array<{ heading: string; articles: any[] }> = [];
  for (const [k, arr] of Object.entries(buckets)) {
    const seen = new Set<string>();
    const uniq = arr.filter(a=>{ if (seen.has(a.link)) return false; seen.add(a.link); return true; });
    if (uniq.length >= 3) result.push({ heading: k, articles: uniq.slice(0,50) });
  }
  result.sort((a,b)=>b.articles.length - a.articles.length);
  return result.slice(0,8);
}

