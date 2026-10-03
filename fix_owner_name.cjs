const fs = require('fs');
const glob = require('glob');

const appFile = 'src/App.jsx';
let appCode = fs.readFileSync(appFile, 'utf8');
if (!appCode.includes(`localStorage.setItem('owner_name'`)) {
    appCode = appCode.replace(
        /const \{ data \} = await supabase\.from\('shops'\)\.select\('\*'\)\.eq\('id', shopId\)\.single\(\);/g,
        "const { data } = await supabase.from('shops').select('*').eq('id', shopId).single();\n      if (data?.owner_name) localStorage.setItem('owner_name', data.owner_name);"
    );
    fs.writeFileSync(appFile, appCode);
}

const files = glob.sync('src/**/*.jsx');
let replacedCount = 0;

for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes("performed_by: 'Owner'")) {
        content = content.replace(/performed_by:\s*'Owner'/g, "performed_by: localStorage.getItem('owner_name') || 'Owner'");
        fs.writeFileSync(file, content);
        replacedCount++;
    }
}
console.log(`Replaced in ${replacedCount} files.`);
