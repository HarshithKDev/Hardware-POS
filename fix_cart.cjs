const fs = require('fs');

let file1 = '/Users/harshithkotian/Desktop/hardware-pos/src/components/cart/CartTable.jsx';
let content1 = fs.readFileSync(file1, 'utf8');

// Replace the line that extracts everything from useCart
content1 = content1.replace(
  /const \{ cart[\s\S]*?\} = useCart\(\);/,
  'const { cart } = useCart();'
);
fs.writeFileSync(file1, content1);

let file2 = '/Users/harshithkotian/Desktop/hardware-pos/src/components/cart/CartMobileView.jsx';
let content2 = fs.readFileSync(file2, 'utf8');

// Replace the line that extracts everything from useCart
content2 = content2.replace(
  /const \{ cart[\s\S]*?\} = useCart\(\);/,
  'const { cart } = useCart();'
);
fs.writeFileSync(file2, content2);
