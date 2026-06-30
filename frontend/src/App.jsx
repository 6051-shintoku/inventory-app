import { useEffect, useMemo, useState } from 'react'

const API_BASE = 'http://localhost:8000'

const HISTORY_FILE_NAME = 'stock_history.csv'

const timestampFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return timestamp
  }

  return timestampFormatter.format(date)
}

const formatQuantity = (quantity) => (quantity > 0 ? `+${quantity}` : `${quantity}`)

const toCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`

export default function App() {
  const [activeView, setActiveView] = useState('products')
  const [products, setProducts] = useState([])
  const [stockLogs, setStockLogs] = useState([])
  const [thresholdEdits, setThresholdEdits] = useState({})
  const [updatingThresholdIds, setUpdatingThresholdIds] = useState({})
  const [historyLoading, setHistoryLoading] = useState(true)
  const [form, setForm] = useState({
    name: '',
    category: '',
    price: '',
    stock_quantity: '',
    threshold: 5,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const productNameById = useMemo(() => {
    return products.reduce((map, product) => {
      map[product.id] = product.name
      return map
    }, {})
  }, [products])

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE}/products`)
      if (!res.ok) throw new Error('商品の取得に失敗しました')
      const data = await res.json()
      setProducts(data)
      setThresholdEdits((prev) => {
        const next = {}
        data.forEach((product) => {
          next[product.id] = prev[product.id] ?? product.threshold
        })
        return next
      })
      return data
    } catch (e) {
      setError(e.message)
      return []
    }
  }

  const fetchStockLogs = async () => {
    setHistoryLoading(true)

    try {
      const res = await fetch(`${API_BASE}/stocklogs`)
      if (!res.ok) throw new Error('入出庫履歴の取得に失敗しました')
      const data = await res.json()
      setStockLogs(data)
      return data
    } catch (e) {
      setError(e.message)
      setStockLogs([])
      return []
    } finally {
      setHistoryLoading(false)
    }
  }

  const refreshInventoryData = async () => {
    await Promise.all([fetchProducts(), fetchStockLogs()])
  }

  useEffect(() => {
    refreshInventoryData()
  }, [])

  const resolveProductName = (productId) => productNameById[productId] ?? `商品ID: ${productId}`

  const downloadHistoryCsv = () => {
    const header = ['日時', '商品名', 'アクション', '数量']
    const rows = stockLogs.map((log) => [
      formatTimestamp(log.timestamp),
      resolveProductName(log.product_id),
      log.action_type,
      formatQuantity(log.change_quantity),
    ])
    const csvContent = [header, ...rows]
      .map((row) => row.map(toCsvCell).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = downloadUrl
    link.download = HISTORY_FILE_NAME
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(downloadUrl)
  }

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          price: Number(form.price),
          stock_quantity: Number(form.stock_quantity),
          threshold: Number(form.threshold),
        }),
      })
      if (!res.ok) throw new Error('商品の登録に失敗しました')
      setForm({ name: '', category: '', price: '', stock_quantity: '', threshold: 5 })
      await refreshInventoryData()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleStock = async (productId, delta) => {
    setError('')

    try {
      const res = await fetch(`${API_BASE}/products/${productId}/stock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change_quantity: delta }),
      })
      if (!res.ok) throw new Error('在庫の更新に失敗しました')
      await refreshInventoryData()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleThresholdInputChange = (productId, value) => {
    setThresholdEdits((prev) => ({
      ...prev,
      [productId]: value,
    }))
  }

  const handleThresholdUpdate = async (productId) => {
    setError('')
    const rawThreshold = thresholdEdits[productId]
    const threshold = Number(rawThreshold)

    if (rawThreshold === '' || !Number.isInteger(threshold) || threshold < 0) {
      setError('しきい値は0以上の整数で入力してください')
      return
    }

    setUpdatingThresholdIds((prev) => ({
      ...prev,
      [productId]: true,
    }))

    try {
      const res = await fetch(`${API_BASE}/products/${productId}/threshold`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || 'しきい値の更新に失敗しました')
      }
      await fetchProducts()
    } catch (e) {
      setError(e.message)
    } finally {
      setUpdatingThresholdIds((prev) => ({
        ...prev,
        [productId]: false,
      }))
    }
  }

  const lowStockProducts = products.filter((product) => product.stock_quantity <= product.threshold)
  const lowStockProductIds = new Set(lowStockProducts.map((product) => product.id))
  const lowStockCount = lowStockProducts.length

  return (
    <main className="container">
      <h1>📦 在庫管理システム</h1>

      <nav aria-label="画面切り替え">
        <ul>
          <li>
            <button
              type="button"
              onClick={() => setActiveView('products')}
              aria-pressed={activeView === 'products'}
              className={activeView === 'products' ? undefined : 'secondary'}
            >
              商品一覧
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setActiveView('history')}
              aria-pressed={activeView === 'history'}
              className={activeView === 'history' ? undefined : 'secondary'}
            >
              入出庫履歴
            </button>
          </li>
        </ul>
      </nav>

      {lowStockCount > 0 && activeView === 'products' && (
        <article
          aria-label="在庫不足アラート"
          style={{
            backgroundColor: 'var(--pico-del-background-color, #fff5f5)',
            border: '1px solid var(--pico-del-color, #e53e3e)',
            color: 'var(--pico-del-color, #e53e3e)',
            padding: '0.75rem 1rem',
          }}
        >
          ⚠️ 在庫が不足している商品が {lowStockCount} 件あります
        </article>
      )}

      {error && (
        <article aria-label="エラー" style={{ backgroundColor: 'var(--pico-del-color)', color: '#fff', padding: '0.5rem 1rem' }}>
          ⚠️ {error}
        </article>
      )}

      {activeView === 'products' ? (
        <>
          <section>
            <h2>商品を登録する</h2>
            <form onSubmit={handleSubmit}>
              <div className="grid">
                <label>
                  商品名
                  <input
                    type="text"
                    name="name"
                    placeholder="例: ボールペン"
                    value={form.name}
                    onChange={handleChange}
                    required
                  />
                </label>
                <label>
                  カテゴリー
                  <input
                    type="text"
                    name="category"
                    placeholder="例: 文具"
                    value={form.category}
                    onChange={handleChange}
                    required
                  />
                </label>
              </div>
              <div className="grid">
                <label>
                  単価（円）
                  <input
                    type="number"
                    name="price"
                    placeholder="例: 100"
                    value={form.price}
                    onChange={handleChange}
                    min="0"
                    required
                  />
                </label>
                <label>
                  初期在庫数
                  <input
                    type="number"
                    name="stock_quantity"
                    placeholder="例: 10"
                    value={form.stock_quantity}
                    onChange={handleChange}
                    min="0"
                    required
                  />
                </label>
                <label>
                  適正在庫（しきい値）
                  <input
                    type="number"
                    name="threshold"
                    placeholder="例: 5"
                    value={form.threshold}
                    onChange={handleChange}
                    min="0"
                    required
                  />
                </label>
              </div>
              <button type="submit" aria-busy={loading} disabled={loading}>
                {loading ? '登録中...' : '登録する'}
              </button>
            </form>
          </section>

          <section>
            <h2>商品一覧</h2>
            {products.length === 0 ? (
              <p>商品が登録されていません。</p>
            ) : (
              <figure>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>商品名</th>
                      <th>カテゴリー</th>
                      <th>単価</th>
                      <th>在庫数</th>
                      <th>しきい値</th>
                      <th>状態</th>
                      <th>在庫操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const isLowStock = lowStockProductIds.has(p.id)

                      return (
                        <tr
                          key={p.id}
                          style={
                            isLowStock
                              ? {
                                  backgroundColor: 'var(--pico-del-background-color, #fff5f5)',
                                }
                              : undefined
                          }
                        >
                          <td>{p.id}</td>
                          <td>{p.name}</td>
                          <td>{p.category}</td>
                          <td>¥{p.price.toLocaleString()}</td>
                          <td>
                            <strong
                              style={{
                                color: isLowStock ? 'var(--pico-color-red-500, #e53e3e)' : 'inherit',
                              }}
                            >
                              {p.stock_quantity}
                            </strong>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <input
                                type="number"
                                min="0"
                                value={thresholdEdits[p.id] ?? p.threshold}
                                onChange={(e) => handleThresholdInputChange(p.id, e.target.value)}
                                style={{ margin: 0, maxWidth: '6.5rem' }}
                              />
                              <button
                                onClick={() => handleThresholdUpdate(p.id)}
                                className="secondary"
                                style={{ margin: 0, padding: '0.25rem 0.75rem' }}
                                aria-busy={updatingThresholdIds[p.id] ? 'true' : undefined}
                                disabled={Boolean(updatingThresholdIds[p.id])}
                              >
                                更新
                              </button>
                            </div>
                          </td>
                          <td>
                            {isLowStock ? (
                              <span style={{ color: 'var(--pico-color-red-500, #e53e3e)' }}>⚠️ 発注推奨</span>
                            ) : (
                              <span style={{ color: 'green' }}>✅ 正常</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <button
                                onClick={() => handleStock(p.id, 1)}
                                style={{ padding: '0.25rem 0.75rem', margin: 0 }}
                              >
                                ＋
                              </button>
                              <button
                                onClick={() => handleStock(p.id, -1)}
                                className="secondary"
                                style={{ padding: '0.25rem 0.75rem', margin: 0 }}
                                disabled={p.stock_quantity <= 0}
                              >
                                ー
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </figure>
            )}
          </section>
        </>
      ) : (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ marginBottom: 0 }}>入出庫履歴</h2>
            <button
              type="button"
              onClick={downloadHistoryCsv}
              disabled={stockLogs.length === 0}
            >
              CSVとしてダウンロード
            </button>
          </div>

          {historyLoading ? (
            <p>履歴を読み込んでいます...</p>
          ) : stockLogs.length === 0 ? (
            <p>入出庫履歴はまだありません。</p>
          ) : (
            <figure>
              <table>
                <thead>
                  <tr>
                    <th>日時</th>
                    <th>商品名</th>
                    <th>アクション</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  {stockLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatTimestamp(log.timestamp)}</td>
                      <td>{resolveProductName(log.product_id)}</td>
                      <td>{log.action_type}</td>
                      <td>
                        <strong
                          style={{
                            color: log.change_quantity < 0 ? 'var(--pico-color-red-500, #e53e3e)' : 'green',
                          }}
                        >
                          {formatQuantity(log.change_quantity)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </figure>
          )}
        </section>
      )}
    </main>
  )
}
