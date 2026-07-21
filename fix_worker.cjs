const fs = require('fs');

let file = '/Users/harshithkotian/Desktop/hardware-pos/src/WorkerTerminal.jsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /export default function WorkerTerminal\(\{ activeTab, shopSettings, cashierName \}\) \{\n  const \{ \n    cart, setCart,/,
  `export default function WorkerTerminal({ activeTab, shopSettings, cashierName }) {
  const { showAlert, showConfirm, alertConfig, confirmConfig } = useApp();
  const queryClient = useQueryClient();

  const { 
    cart, setCart,`
);

fs.writeFileSync(file, content);
