#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  Tool,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

// Tool definitions
const previewFileTool: Tool = {
  name: 'preview_file',
  description: 'Preview local HTML file and capture screenshot',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to local HTML file' },
      width: { type: 'number', description: 'Viewport width', default: 1024 },
      height: { type: 'number', description: 'Viewport height', default: 768 }
    },
    required: ['filePath']
  }
};

const analyzeContentTool: Tool = {
  name: 'analyze_content',
  description: 'Analyze HTML content structure',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to local HTML file' }
    },
    required: ['filePath']
  }
};

class FilePreviewWrapper {
  private browser: puppeteer.Browser | null = null;

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch();
    }
    return this.browser;
  }

  async previewFile(filePath: string, width = 1024, height = 768) {
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
      await page.evaluate((): Promise<void[]> => {
        return Promise.all(
          Array.from(document.images)
            .filter(img => !img.complete)
            .map(img => new Promise<void>((resolve) => {
              img.onload = img.onerror = () => resolve();
            }))
        );
      });

      // Small delay for any animations/transitions
      await new Promise<void>(resolve => setTimeout(resolve, 1000));

      // Create screenshots directory if it doesn't exist
      const screenshotsDir = path.join('/Users/seanivore/Projects/mcp-file-preview', 'screenshots');
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
        screenshotPath,
        content
      };
    } finally {
      await page.close();
    }
  }

  async analyzeContent(filePath: string) {
    if (!fs.existsSync(filePath)) {
      throw new McpError(ErrorCode.InvalidRequest, `File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    
    return {
      headings: (content.match(/<h[1-6][^>]*>.*?<\/h[1-6]>/g) || []).length,
      paragraphs: (content.match(/<p[^>]*>.*?<\/p>/g) || []).length,
      images: (content.match(/<img[^>]*>/g) || []).length,
      links: (content.match(/<a[^>]*>.*?<\/a>/g) || []).length,
    };
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

async function main() {
  const server = new Server(
    {
      name: "File Preview MCP Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {
          list: true,
          read: true,
          listTemplates: true,
          listChanged: true,
          subscribe: true
        },
        prompts: {},
        tools: {
          preview_file: previewFileTool,
          analyze_content: analyzeContentTool
        }
      },
    }
  );

  const filePreview = new FilePreviewWrapper();

  // Handle tool execution requests
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      try {
        if (!request.params.arguments) {
          throw new Error("No arguments provided");
        }

        switch (request.params.name) {
          case "preview_file": {
            const args = request.params.arguments as { filePath: string; width?: number; height?: number };
            if (!args.filePath) {
              throw new Error("Missing required argument: filePath");
            }
            const result = await filePreview.previewFile(args.filePath, args.width, args.height);
            return {
              content: [
                {
                  type: "text",
                  text: `Screenshot saved to: ${result.screenshotPath}\n\nHTML Content:\n${result.content}`
                }
              ],
            };
          }

          case "analyze_content": {
            const args = request.params.arguments as { filePath: string };
            if (!args.filePath) {
              throw new Error("Missing required argument: filePath");
            }
            const analysis = await filePreview.analyzeContent(args.filePath);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(analysis, null, 2)
                }
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    }
  );

  // Handle tool listing requests
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [previewFileTool, analyzeContentTool],
    };
  });

  // Handle resource listing requests
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "file://preview/html",
          name: "HTML Preview",
          description: "Preview HTML files with styling",
          mimeType: "text/html"
        }
      ]
    };
  });

  // Handle resource template listing requests
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "file://preview/html/{path}",
          name: "HTML File Preview",
          description: "Preview any HTML file with its associated CSS",
          mimeType: "text/html"
        }
      ]
    };
  });

  // Handle resource read requests
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const match = uri.match(/^file:\/\/preview\/html\/(.+)$/);
    
    if (!match) {
      throw new McpError(ErrorCode.InvalidRequest, `Invalid resource URI format: ${uri}`);
    }

    const filePath = decodeURIComponent(match[1]);
    try {
      const result = await filePreview.previewFile(filePath);
      return {
        contents: [
          {
            uri,
            mimeType: "text/html",
            text: result.content
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Handle prompts listing requests
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: []
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);


  process.on('SIGINT', async () => {
    await filePreview.cleanup();
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
