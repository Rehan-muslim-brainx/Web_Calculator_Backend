export const fmtUSD = (val) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0)

export const fmtPct = (val) => `${((val || 0) * 100).toFixed(2)}%`
