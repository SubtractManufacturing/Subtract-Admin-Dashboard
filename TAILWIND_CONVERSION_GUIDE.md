# Tailwind CSS Conversion Guide

## Status
- ✅ Tailwind CSS installed and configured
- ✅ Core components converted (Navbar, Button, Modal, FormField, SearchHeader)
- ✅ Utility styles created in `app/utils/tw-styles.ts`
- ⏳ Route pages need conversion
- ⏳ Table components need conversion

## Common Conversions

### Tables
```jsx
// Old
<table className="orders-table">

// New
<table className={tableStyles.container}>
```

### Status Classes
```jsx
// Old
<td className={`status ${getStatusClass(order.status)}`}>

// New
<td className={`${statusStyles.base} ${statusStyles[status]}`}>
```

### Sections
```jsx
// Old
<div className="section">

// New
<div className="px-10 py-8">
```

### Common Patterns
- `display: flex` → `flex`
- `justify-content: space-between` → `justify-between`
- `align-items: center` → `items-center`
- `margin-bottom: 20px` → `mb-5`
- `gap: 8px` → `gap-2`
- `text-align: center` → `text-center`
- `padding: 40px` → `p-10`
- `color: gray` → `text-gray-500`

## Files Remaining to Convert
1. app/routes/_index.tsx
2. app/routes/customers.tsx
3. app/routes/vendors.tsx
4. app/routes/orders.tsx
5. app/components/OrdersTable.tsx
6. app/components/QuotesTable.tsx
7. app/components/StatCards.tsx
8. app/components/LineItemsTable.tsx

## To Complete Conversion
1. Convert remaining route files using the patterns above
2. Convert table components to use tableStyles
3. Remove app/styles/dashboard.css
4. Remove app/app.css
5. Test all pages for visual consistency