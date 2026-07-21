import re

file_path = 'src/WorkerTerminal.jsx'

with open(file_path, 'r') as f:
    content = f.read()

# 1. Add import for useCart
content = re.sub(
    r"import { PrintPreviewModal } from '\./AppModals';",
    "import { PrintPreviewModal } from './AppModals';\nimport { useCart } from './contexts/CartContext';",
    content
)

# 2. Replace state definitions with useCart destructuring
state_block = """  const [cart, setCart] = useState(() => {
    try { const saved = localStorage.getItem(`pos_cart_${activeTab}`); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });"""

replacement_block = """  const { 
    cart, setCart, 
    activeCartTab, switchCartTab, 
    cartSessions, setCartSessions, 
    heldCarts, setHeldCarts,
    clearCart,
    updateQuantity,
    updateDimensions,
    customPriceChange,
    customPriceBlur,
    customPriceChangeGroup,
    customPriceBlurGroup,
    removeItem: handleRemoveItem
  } = useCart();"""

content = content.replace(state_block, replacement_block)

# 3. Remove local heldCarts, cartSessions, activeCartTab, etc.
content = re.sub(r"  const \[activeCartTab, setActiveCartTab\] = useState\('local'\);\n", "", content)
content = re.sub(r"  const \[cartSessions, setCartSessions\] = useState\(\{ local: cart \}\);\n", "", content)
content = re.sub(r"  // Held Carts\n  const \[heldCarts, setHeldCarts\] = useState\(\(\) => \{\n    try \{ const saved = localStorage.getItem\(`pos_held_carts_\$\{activeTab\}`\); return saved \? JSON.parse\(saved\) : \[\]; \} catch \{ return \[\]; \}\n  \}\);\n", "", content)

# 4. Remove local effects related to cart storage
content = re.sub(r"  useEffect\(\(\) => \{ \n    cartRef\.current = cart; \n    if \(activeCartTab === 'local'\) \{\n      localStorage\.setItem\(`pos_cart_\$\{activeTab\}`\, JSON\.stringify\(cart\)\); \n    \}\n  \}, \[cart, activeTab, activeCartTab\]\);\n", "  useEffect(() => { cartRef.current = cart; }, [cart]);\n", content)
content = re.sub(r"  useEffect\(\(\) => \{\n    localStorage\.setItem\(`pos_held_carts_\$\{activeTab\}`\, JSON\.stringify\(heldCarts\)\);\n  \}, \[heldCarts, activeTab\]\);\n", "", content)
content = re.sub(r"  useEffect\(\(\) => \{\n    // Sync active held cart modifications into heldCarts array so it persists instantly\n    if \(activeCartTab\.startsWith\('held_'\)\) \{\n      setHeldCarts\(prev => prev\.map\(c => c\.id === activeCartTab \? \{ \.\.\.c, items: cart \} : c\)\);\n    \}\n  \}, \[cart, activeCartTab\]\);\n", "", content)

# 5. Remove local switchCartTab
content = re.sub(r"  const switchCartTab = \(tabId\) => \{.*?\};\n", "", content, flags=re.DOTALL)

# 6. Remove local clearCart, updateQuantity, etc.
# These functions span a lot of lines. I'll just remove them manually or via regex.
# Actually, I can just replace them with empty strings if I find their exact block.
content = re.sub(r"  const updateQuantity = \(id, newQty\) => \{.*?\};\n", "", content, flags=re.DOTALL)
content = re.sub(r"  const updateDimensions = \(id, field, value\) => \{.*?\};\n", "", content, flags=re.DOTALL)
content = re.sub(r"  const onCustomPriceChange = \(id, val\) => \{.*?\};\n", "", content, flags=re.DOTALL)
content = re.sub(r"  const onCustomPriceBlur = \(id\) => \{.*?\};\n", "", content, flags=re.DOTALL)
content = re.sub(r"  const onCustomPriceChangeGroup = \(barcode, val\) => \{.*?\};\n", "", content, flags=re.DOTALL)
content = re.sub(r"  const onCustomPriceBlurGroup = \(barcode\) => \{.*?\};\n", "", content, flags=re.DOTALL)
content = re.sub(r"  const handleRemoveItem = \(id\) => \{.*?\};\n", "", content, flags=re.DOTALL)

# And fix pendingCarts switch logic which wasn't fully extracted to useCart because pendingCarts is local to WorkerTerminal
# Wait, CartContext switchCartTab does NOT handle pendingCarts properly because it doesn't have access to pendingCarts!
with open(file_path, 'w') as f:
    f.write(content)

