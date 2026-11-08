import type { Foundation } from '../api'
import { EvidenceList } from '../jump'
import { foundationLinks } from './foundationLinks'

/** 先に読むとよい論文。0本、または古い結果（foundations なし）なら欄ごと出さない */
export function FoundationPapers({ items }: { items: Foundation[] | undefined }) {
  if (!items?.length) return null
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return (
    <section className="block" aria-labelledby="foundations-heading">
      <h2 id="foundations-heading">先に読むとよい論文</h2>
      <p className="muted small">この論文の参考文献から、手法のもとになっているものをAIが選びました。</p>
      <ol className="foundations">
        {sorted.map((f, i) => (
          <li key={`${i}-${f.title}`} className="foundation">
            <span className="order-num" aria-hidden="true">
              {i + 1}
            </span>
            <div className="order-body">
              <strong className="foundation-title">{f.title}</strong>
              {(f.authors || f.year != null) && (
                <span className="muted small">{[f.authors, f.year != null ? String(f.year) : ''].filter(Boolean).join('、')}</span>
              )}
              <span className="small">{f.reason}</span>
              <div className="foundation-meta">
                <EvidenceList items={f.evidence ?? []} />
                <span className="chips foundation-links">
                  {foundationLinks(f).map((l) => (
                    <a
                      key={l.label}
                      className="chip page"
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${f.title} ${l.label === '検索' ? 'を検索' : `の ${l.label}`}(新しいタブで開く)`}
                    >
                      {l.label}
                    </a>
                  ))}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
