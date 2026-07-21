const fs = require('fs');

let file = '/Users/harshithkotian/Desktop/hardware-pos/src/WorkerTerminal.jsx';
let content = fs.readFileSync(file, 'utf8');

// The python script added a block of destructured variables from useCart. 
// It looks like this:
//   const { 
//     cart, setCart, 
//     ...
//     removeItem: handleRemoveItem
//   } = useCart();

// I need to change it so it ONLY extracts cart, setCart, activeCartTab, cartSessions, setCartSessions, heldCarts, setHeldCarts, clearCart.
// And it doesn't extract updateQuantity etc., because WorkerTerminal defines its own!

content = content.replace(
  /const \{[\s\S]*?removeItem: handleRemoveItem\n\s*\} = useCart\(\);/,
  `const { 
    cart, setCart, 
    activeCartTab,
    cartSessions, setCartSessions, 
    heldCarts, setHeldCarts,
    clearCart
  } = useCart();`
);

fs.writeFileSync(file, content);
