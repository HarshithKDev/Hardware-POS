const fs = require('fs');
const glob = require('glob'); // Not guaranteed to be installed, I'll just use fs.readdirSync recursively
function findAndReplace(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    if (file.isDirectory() && file.name !== 'node_modules' && file.name !== '.git') {
      findAndReplace(`${dir}/${file.name}`);
    } else if (file.isFile() && (file.name.endsWith('.js') || file.name.endsWith('.jsx'))) {
      const filePath = `${dir}/${file.name}`;
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(".from('inventory')")) {
        content = content.replace(/\.from\('inventory'\)/g, ".from('product_master')");
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
      }
    }
  }
}
findAndReplace('./src');
