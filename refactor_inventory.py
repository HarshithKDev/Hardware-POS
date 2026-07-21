import re

with open('src/OwnerInventory.jsx', 'r') as f:
    content = f.read()

# 1. Add import TableVirtuoso
if 'TableVirtuoso' not in content:
    content = content.replace("import React, { useState, useMemo, useCallback } from 'react';", "import React, { useState, useMemo, useCallback, forwardRef } from 'react';\nimport { TableVirtuoso } from 'react-virtuoso';")

# 2. Remove invPage state
content = re.sub(r"const \[invPage, setInvPage\] = useState\(0\);\n\s*", "", content)

# 3. Replace limit/offset in query
content = re.sub(
    r"const from = invPage \* INV_PER_PAGE;\n\s*const \{ data, totalCount \} = await getInventoryByQuery\(\{\n\s*limit: INV_PER_PAGE,\n\s*offset: from,",
    "const { data, totalCount } = await getInventoryByQuery({\n        limit: 1000000,\n        offset: 0,",
    content
)

# 4. Remove setInvPage(0) everywhere
content = re.sub(r"setInvPage\(0\);\s*", "", content)
content = re.sub(r"const INV_PER_PAGE = 50;\n\s*", "", content)

# 5. Remove queryKey dependencies on invPage
content = re.sub(r"'inventory', viewType, invPage,", "'inventory', viewType,", content)

# 6. Replace table with TableVirtuoso
table_virtuoso = """      <div className="flex-1 min-h-[300px] md:shadow-sm md:rounded-lg overflow-hidden flex flex-col" style={{ backgroundColor: 'transparent' }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><p style={{color: 'var(--text-tertiary)'}}>Loading inventory...</p></div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-full"><p style={{color: 'var(--text-tertiary)'}}>No items found matching the search.</p></div>
        ) : (
          <TableVirtuoso
            data={items}
            useWindowScroll={false}
            style={{ height: '100%', width: '100%' }}
            components={{
              Table: (props) => <table {...props} className="w-full text-center md:whitespace-nowrap border-collapse block md:table min-w-0 md:min-w-[1100px]" style={{...props.style}} />,
              TableHead: forwardRef((props, ref) => <thead ref={ref} {...props} className="hidden md:table-header-group sticky top-0 z-10" style={{ ...props.style, backgroundColor: 'var(--bg-quaternary)', borderBottom: '1px solid var(--border-medium)' }} />),
              TableBody: forwardRef((props, ref) => <tbody ref={ref} {...props} className="block md:table-row-group" style={{ ...props.style, borderBottom: '1px solid var(--border-medium)' }} />),
              TableRow: (props) => <tr {...props} className="block md:table-row border-b border-[var(--border-light)] md:border-none" />
            }}
            fixedHeaderContent={() => (
              <tr className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                {isSelectionMode && (
                  <th className="p-3 w-12 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>
                    <input type="checkbox" checked={items.length > 0 && selectedBarcodes.length === items.length} onChange={toggleSelectAll} className="w-4 h-4 rounded text-accent focus:ring-accent cursor-pointer" />
                  </th>
                )}
                <th className="p-3 min-w-[120px]" style={{ borderRight: '1px solid var(--border-light)' }}>Barcode</th>
                <th className="p-3 min-w-[160px]" style={{ borderRight: '1px solid var(--border-light)' }}>Item Details</th>
                <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Category</th>
                <th className="p-3 w-28" style={{ borderRight: '1px solid var(--border-light)' }}>Sub-category</th>
                <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Cost</th>
                <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>MSP</th>
                <th className="p-3 w-20 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>MRP</th>
                <th className="p-3 w-24 text-center" style={{ borderRight: '1px solid var(--border-light)' }}>Whse Qty</th>
                <th className="p-3 w-24 text-center">Store Qty</th>
              </tr>
            )}
            itemContent={(index, item) => (
              <InventoryRow
                key={item.barcode}
                item={item}
                viewType={viewType}
                categories={categories}
                subcategories={subcategories}
                isSelected={selectedBarcodes.includes(item.barcode)}
                onSelect={toggleSelect}
                isGlobalEditMode={isGlobalEditMode}
                editData={bulkEditData[item.barcode]}
                onEditChange={handleBulkEditChange}
                onRestore={handleRestore}
                isSelectionMode={isSelectionMode}
                expandedBarcode={expandedBarcode}
                onToggleExpand={(barcode) => setExpandedBarcode(prev => prev === barcode ? null : barcode)}
              />
            )}
          />
        )}
      </div>"""

# Replace the div containing table
content = re.sub(r'<div className="overflow-x-auto overflow-y-hidden flex-1 min-h-\[300px\].*?</div>\s*<div className="flex justify-between items-center mt-2 pt-2 gap-2">.*?</div>', table_virtuoso, content, flags=re.DOTALL)

with open('src/OwnerInventory.jsx', 'w') as f:
    f.write(content)
