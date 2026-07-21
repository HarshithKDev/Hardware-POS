const fs = require('fs');

let file = '/Users/harshithkotian/Desktop/hardware-pos/src/WorkerTerminal.jsx';
let content = fs.readFileSync(file, 'utf8');

// I need to add removeItem: handleRemoveItem, customPriceChange: onCustomPriceChange, etc. back to the useCart destructuring.
content = content.replace(
  /const \{ \n    cart, setCart,/,
  `const { 
    cart, setCart,
    removeItem: handleRemoveItem,
    customPriceChange: onCustomPriceChange,
    customPriceBlur: onCustomPriceBlur,
    customPriceChangeGroup: onCustomPriceChangeGroup,
    customPriceBlurGroup: onCustomPriceBlurGroup,`
);

fs.writeFileSync(file, content);
