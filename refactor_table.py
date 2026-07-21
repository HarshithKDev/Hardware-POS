import re

with open('src/OwnerInventory.jsx', 'r') as f:
    content = f.read()

# Replace TableRow and itemContent
old_table_virtuoso = """              TableRow: (props) => <tr {...props} className="block md:table-row border-b border-[var(--border-light)] md:border-none" />
            }}
            fixedHeaderContent={() => ("""

new_table_virtuoso = """              TableRow: ({ item, children, ...props }) => (
                <InventoryRow
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
                  virtuosoProps={props}
                />
              )
            }}
            fixedHeaderContent={() => ("""

content = content.replace(old_table_virtuoso, new_table_virtuoso)

old_item_content = """            itemContent={(index, item) => (
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
            )}"""

new_item_content = """            itemContent={() => null}"""

content = content.replace(old_item_content, new_item_content)

with open('src/OwnerInventory.jsx', 'w') as f:
    f.write(content)
