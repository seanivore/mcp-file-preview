# MCP File Preview Server

A Model Context Protocol (MCP) server that provides HTML file preview and analysis capabilities. This server enables capturing full-page screenshots of local HTML files and analyzing their structure.

## Features

- **File Preview**: Capture full-page screenshots of HTML files with proper CSS styling
- **Content Analysis**: Analyze HTML structure (headings, paragraphs, images, links)
- **Local File Support**: Handle local file paths and resources
- **Screenshot Management**: Save screenshots to a dedicated directory

## Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/mcp-file-preview.git
cd mcp-file-preview
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

Add the server to your Claude or Cline MCP settings:

### Claude Desktop App
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "file-preview": {
      "command": "node",
      "args": ["/path/to/mcp-file-preview/build/index.js"]
    }
  }
}
```

### Cline VSCode Extension
Add to VSCode's MCP settings:
```json
{
  "mcpServers": {
    "file-preview": {
      "command": "node",
      "args": ["/path/to/mcp-file-preview/build/index.js"]
    }
  }
}
```

## Usage

The server provides two main tools:

### preview_file
Captures a screenshot and returns HTML content:
```typescript
<use_mcp_tool>
<server_name>file-preview</server_name>
<tool_name>preview_file</tool_name>
<arguments>
{
  "filePath": "/path/to/file.html",
  "width": 1024,  // optional
  "height": 768   // optional
}
</arguments>
</use_mcp_tool>
```

Screenshots are saved to `screenshots/` directory in the project folder.

### analyze_content
Analyzes HTML structure:
```typescript
<use_mcp_tool>
<server_name>file-preview</server_name>
<tool_name>analyze_content</tool_name>
<arguments>
{
  "filePath": "/path/to/file.html"
}
</arguments>
</use_mcp_tool>
```

Returns counts of:
- Headings
- Paragraphs
- Images
- Links

## Development

1. Make changes in `src/`
2. Build:
```bash
npm run build
```
3. Test locally:
```bash
npm run dev
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
