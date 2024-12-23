#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

class FilePreviewServer {
  private server: Server;
  private browser: puppeteer.Browser | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'file-preview-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
  }

  private async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch();
    }
    return this.browser;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'preview_file',
          description: 'Preview local HTML file and capture screenshot',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Path to local HTML file',
              },
              width: {
                type: 'number',
                description: 'Viewport width',
                default: 1024,
              },
              height: {
                type: 'number',
                description: 'Viewport height',
                default: 768,
              },
            },
            required: ['filePath'],
          },
        },
        {
          name: 'analyze_content',
          description: 'Analyze HTML content structure',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Path to local HTML file',
              },
            },
            required: ['filePath'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'preview_file':
          return this.handlePreviewFile(request.params.arguments);
        case 'analyze_content':
          return this.handleAnalyzeContent(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handlePreviewFile(args: any) {
    const { filePath, width = 1024, height = 768 } = args;
    
    if (!fs.existsSync(filePath)) {
      throw new McpError(ErrorCode.InvalidRequest, `File not found: ${filePath}`);
    }

    const browser = await this.initBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    try {
      // Configure browser for better external resource handling
      await page.setBypassCSP(true);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/91.0.4472.114'
      });
      
      // Navigate with longer timeout and wait for network idle
      await page.goto(`file://${filePath}`, { 
        waitUntil: ['networkidle0', 'load', 'domcontentloaded'],
        timeout: 30000 
      });
      
      // Read and inject CSS files
      const baseDir = path.dirname(filePath);
      const mainCss = fs.readFileSync(path.join(baseDir, '..', 'style.css'), 'utf-8');
      const pageCss = fs.readFileSync(path.join(baseDir, path.basename(filePath).replace('.html', '.css')), 'utf-8');
      
      await page.addStyleTag({ content: mainCss });
      await page.addStyleTag({ content: pageCss });

      // Wait for all resources to load
      await page.evaluate(() => {
        return Promise.all(
          Array.from(document.images)
            .filter(img => !img.complete)
            .map(img => new Promise(resolve => {
              img.onload = img.onerror = resolve;
            }))
        );
      });

      // Small delay for any animations/transitions
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create screenshots directory if it doesn't exist
      const screenshotsDir = path.join('/Users/seanivore/Documents/Cline/MCP/mcp-file-preview', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }

      // Generate screenshot filename based on original file
      const screenshotName = `${path.basename(filePath, '.html')}_${Date.now()}.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotName);

      // Take full page screenshot and save to file
      await page.screenshot({ 
        fullPage: true,
        path: screenshotPath
      });
      const content = await page.content();

      return {
        content: [
          {
            type: 'text',
            text: `Screenshot saved to: ${screenshotPath}\n\nHTML Content:\n${content}`
          }
        ],
      };
    } finally {
      await page.close();
    }
  }

  private async handleAnalyzeContent(args: any) {
    const { filePath } = args;

    if (!fs.existsSync(filePath)) {
      throw new McpError(ErrorCode.InvalidRequest, `File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Basic HTML structure analysis
    const analysis = {
      headings: (content.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/g) || []).length,
      paragraphs: (content.match(/<p[^>]*>.*?<\/p>/g) || []).length,
      images: (content.match(/<img[^>]*>/g) || []).length,
      links: (content.match(/<a[^>]*>.*?<\/a>/g) || []).length,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(analysis, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('File Preview MCP server running on stdio');

    process.on('SIGINT', async () => {
      if (this.browser) {
        await this.browser.close();
      }
      await this.server.close();
      process.exit(0);
    });
  }
}

const server = new FilePreviewServer();
server.run().catch(console.error);
