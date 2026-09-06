const fs = require('fs');
const content = fs.readFileSync('src/index.css', 'utf8');

// Replace the TABLE BORDER STANDARDIZATION block
const newBlock = `
/* TABLE BORDER STANDARDIZATION */
.hw-table-wrapper {
  width: 100%;
  overflow: hidden;
  border-radius: 0.5rem;
  border: 1px solid var(--border-light);
  background-color: var(--bg-primary);
  /* Fix Safari border-radius overflow issue */
  transform: translateZ(0); 
}
.hw-table {
  width: 100%;
  text-align: left;
  /* Use separate to respect wrapper border-radius */
  border-collapse: separate; 
  border-spacing: 0;
}
.hw-table th, .hw-table td {
  border-bottom: 1px solid var(--border-light);
  border-right: 1px solid var(--border-light);
}
.hw-table th:last-child, .hw-table td:last-child {
  border-right: none !important;
}
/* Handle both tbody and direct tr children (Virtuoso) */
.hw-table tbody tr:last-child td,
.hw-table > tr:last-child td,
.hw-table tr:last-child td {
  border-bottom: none !important;
}
`;

const updatedContent = content.replace(/\/\* TABLE BORDER STANDARDIZATION \*\/[\s\S]*/, newBlock.trim());
fs.writeFileSync('src/index.css', updatedContent);

// Fix inputs having same border as background in dark mode
// by making border lighter.
const cssLines = updatedContent.split('\n');
const borderInputFix = updatedContent.replace(
  /border: 1px solid var\(--border-input\);/,
  'border: 1px solid var(--border-medium); /* Lighter border for visibility */'
);
fs.writeFileSync('src/index.css', borderInputFix);

console.log("CSS fixed");
