import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { title: string; children: ReactNode }
type State = { error: Error | null }

/** 子の描画で例外が出ても画面全体を真っ白にせず、その範囲だけにメッセージを出す。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('描画に失敗しました', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error boundary" role="alert">
        <p>
          <strong>{this.props.title}</strong>
        </p>
        <p className="small">解析結果の形式が想定と異なる可能性があります。（{this.state.error.message}）</p>
        <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
          もう一度表示する
        </button>
      </div>
    )
  }
}
