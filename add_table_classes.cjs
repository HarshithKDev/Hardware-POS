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
  
  // Replace <table className="
  content = content.replace(/<table\s+className="/g, '<table className="hw-table ');
  
  // Replace <table className={`
  content = content.replace(/<table\s+className=\{\`/g, '<table className={`hw-table ');
  
  // Remove redundant Tailwind classes if they are right next to hw-table
  // It's fine to leave them, but let's just make sure we didn't add hw-table twice.
  content = content.replace(/hw-table\s+hw-table/g, 'hw-table');
  
  // Also clean inline borderTop which we missed, if any
  content = content.replace(/,\s*borderTop:\s*'[^']+'/g, '');
  content = content.replace(/borderTop:\s*'[^']+',\s*/g, '');
  content = content.replace(/borderTop:\s*'[^']+'/g, '');
  content = content.replace(/style=\{\{\s*\}\}/g, '');

  fs.writeFileSync(filePath, content, 'utf8');
}

processDir(path.join(__dirname, 'src'));
console.log("Table classes injected!");
