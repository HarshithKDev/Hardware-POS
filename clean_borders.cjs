const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.jsx')) {
      cleanFile(fullPath);
    }
  }
}

function cleanFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace inline border styles
  content = content.replace(/,\s*borderRight:\s*'[^']+'/g, '');
  content = content.replace(/borderRight:\s*'[^']+',\s*/g, '');
  content = content.replace(/borderRight:\s*'[^']+'/g, '');
  
  content = content.replace(/,\s*borderBottom:\s*'[^']+'/g, '');
  content = content.replace(/borderBottom:\s*'[^']+',\s*/g, '');
  content = content.replace(/borderBottom:\s*'[^']+'/g, '');
  
  // Clean empty style={{}}
  content = content.replace(/style=\{\{\s*\}\}/g, '');
  // Clean empty style={ {  } }
  content = content.replace(/style=\{\{\s*\}\}/g, '');
  
  // Add hw-table class to tables
  // We want to replace <table className="..."> with <table className="hw-table ...">
  // and remove common border utilities like w-full text-left etc that we put in CSS.
  content = content.replace(/<table\s+className="([^"]*)"/g, (match, classes) => {
    let newClasses = classes.replace(/\bw-full\b/g, '')
                            .replace(/\btext-left\b/g, '')
                            .replace(/\bborder-collapse\b/g, '')
                            .replace(/\bborder\b/g, '')
                            .replace(/\bborder-light\b/g, '')
                            .replace(/\bborder-medium\b/g, '')
                            .replace(/\bborder-\[var\(--border-light\)\]\b/g, '')
                            .replace(/\brounded-lg\b/g, '')
                            .replace(/\boverflow-hidden\b/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
    if (!newClasses.includes('hw-table')) {
      newClasses = 'hw-table ' + newClasses;
    }
    return `<table className="${newClasses.trim()}"`;
  });
  
  // Wrap table with hw-table-wrapper div
  // Actually, wait, replacing DOM structure via Regex is super risky because of nested tags.
  // I will just do the inline style removal and table class assignment via Regex.
  // The table wrappers can be done manually or left to the CSS `hw-table` to handle.
  
  fs.writeFileSync(filePath, content, 'utf8');
}

processDir(path.join(__dirname, 'src'));
console.log("Cleanup complete!");
