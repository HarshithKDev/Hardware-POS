import os

files_to_fix = [
    "src/WorkerTerminal.jsx",
    "src/StockInstancesModal.jsx",
    "src/WorkerDashboardView.jsx",
    "src/CreateBatchModal.jsx",
    "src/PrintBatchModal.jsx"
]

for filepath in files_to_fix:
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r') as f:
        content = f.read()

    # WorkerTerminal Headers
    content = content.replace(
        '<button type="button" onClick={() => setLooseItemModal({ isOpen: false, item: null, qty: \'\' })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={() => setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false, action: \'checkout\' })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={() => setReceiveLengthModal({ isOpen: false, item: null, length: \'\', batch: null, instanceBarcode: null })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={() => setManualInstanceBarcodeModal({ isOpen: false, item: null, batch: null, barcodeInput: \'\', prefix: \'\' })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={() => setCutLengthModal({ isOpen: false, item: null, instance: null, cutQty: \'\', discardScrap: false })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md text-lg">✕</button>',
        ''
    )
    content = content.replace(
        '<button onClick={() => setSelectBatchModal({ isOpen: false, item: null, batches: [] })} className="px-3 py-1.5 leading-none focus:outline-none rounded-md" aria-label="Close batch selection">✕</button>',
        ''
    )
    
    # WorkerTerminal Footers
    content = content.replace(
        '<button onClick={() => setSelectBatchModal({ isOpen: false, item: null, batches: [] })} className="h-9 px-8 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md" style={{ backgroundColor: \'var(--bg-hover)\', color: \'var(--text-primary)\', border: \'1px solid var(--border-medium)\' }}>Cancel</button>',
        '<button onClick={() => setSelectBatchModal({ isOpen: false, item: null, batches: [] })} className="h-9 px-8 text-sm font-semibold disabled:opacity-50 focus:outline-none rounded-md text-white transition-opacity hover:opacity-90" style={{ backgroundColor: \'var(--color-error)\' }}>Cancel</button>'
    )
    content = content.replace(
        '<button onClick={() => setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false, action: \'checkout\' })} className="h-9 px-8 text-sm font-semibold focus:outline-none rounded-md" style={{ backgroundColor: \'var(--bg-hover)\', color: \'var(--text-primary)\', border: \'1px solid var(--border-medium)\' }}>Close</button>',
        '<button onClick={() => setSelectPieceModal({ isOpen: false, item: null, instances: [], isLoading: false, action: \'checkout\' })} className="h-9 px-8 text-sm font-semibold focus:outline-none rounded-md text-white transition-opacity hover:opacity-90" style={{ backgroundColor: \'var(--color-error)\' }}>Close</button>'
    )

    # WorkerDashboardView
    content = content.replace(
        '<button type="button" onClick={() => setLowStockModal({ isOpen: false, type: null })} className="px-3 py-1.5 leading-none focus:outline-none text-lg" style={{ color: \'var(--text-secondary)\' }}>✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={() => setLowStockModal({ isOpen: false, type: null })} className="h-9 px-8 text-white rounded-md text-sm font-semibold focus:outline-none transition-opacity hover:opacity-90" style={{ backgroundColor: \'var(--color-accent)\' }}>Close Window</button>',
        '<button type="button" onClick={() => setLowStockModal({ isOpen: false, type: null })} className="h-9 px-8 text-white rounded-md text-sm font-semibold focus:outline-none transition-opacity hover:opacity-90" style={{ backgroundColor: \'var(--color-error)\' }}>Close Window</button>'
    )
    
    # PrintBatchModal
    content = content.replace(
        '<button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>',
        ''
    )
    content = content.replace(
        '<button onClick={onClose} className="px-4 py-2 border rounded-md" style={{ borderColor: \'var(--border-medium)\', color: \'var(--text-secondary)\' }}>Cancel</button>',
        '<button onClick={onClose} className="px-4 py-2 rounded-md text-white" style={{ backgroundColor: \'var(--color-error)\' }}>Cancel</button>'
    )

    # StockInstancesModal (Discard modal)
    content = content.replace(
        '<button type="button" onClick={() => setDiscardModal({ isOpen: false, group: null, inputBarcode: \'\' })} className="p-2 leading-none focus:outline-none rounded-md text-[var(--text-secondary)] hover:text-[var(--color-error)] transition-colors">✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={() => setDiscardModal({ isOpen: false, group: null, inputBarcode: \'\' })} className="px-4 py-2 text-sm font-bold rounded-md border" style={{ borderColor: \'var(--border-medium)\', color: \'var(--text-primary)\' }}>Cancel</button>',
        '<button type="button" onClick={() => setDiscardModal({ isOpen: false, group: null, inputBarcode: \'\' })} className="px-4 py-2 text-sm font-bold rounded-md text-white" style={{ backgroundColor: \'var(--color-error)\' }}>Cancel</button>'
    )

    # StockInstancesModal (Print modal)
    content = content.replace(
        '<button onClick={() => setPrintModal({ isOpen: false, group: null, qty: 1 })} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>',
        ''
    )
    content = content.replace(
        '<button onClick={() => setPrintModal({ isOpen: false, group: null, qty: 1 })} className="px-4 py-2 border rounded-md" style={{ borderColor: \'var(--border-medium)\', color: \'var(--text-secondary)\' }}>Cancel</button>',
        '<button onClick={() => setPrintModal({ isOpen: false, group: null, qty: 1 })} className="px-4 py-2 rounded-md text-white" style={{ backgroundColor: \'var(--color-error)\' }}>Cancel</button>'
    )

    # CreateBatchModal
    content = content.replace(
        '<button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>',
        ''
    )
    content = content.replace(
        '<button type="button" onClick={onClose} className="px-4 py-2 border rounded-md" style={{ borderColor: \'var(--border-medium)\', color: \'var(--text-secondary)\' }}>Cancel</button>',
        '<button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-white" style={{ backgroundColor: \'var(--color-error)\' }}>Cancel</button>'
    )

    with open(filepath, 'w') as f:
        f.write(content)

