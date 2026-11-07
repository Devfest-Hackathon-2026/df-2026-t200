"""テスト共通設定。app を import する前に、保存先を一時ディレクトリにしてデモモードを強制する。"""

import atexit
import os
import shutil
import tempfile
from types import SimpleNamespace

_DATA = tempfile.mkdtemp(prefix="paper-test-")
atexit.register(shutil.rmtree, _DATA, ignore_errors=True)
os.environ["DATA_DIR"] = _DATA
os.environ["DEMO_MODE"] = "1"

import pytest  # noqa: E402
from make_sample_pdf import make_pdf  # noqa: E402

from app import config  # noqa: E402


@pytest.fixture
def sample_pdf() -> bytes:
    return make_pdf(3)


@pytest.fixture(autouse=True)
def _clean_data_dir():
    """テストごとに保存済みの論文を消して独立させる。"""
    for d in (config.UPLOAD_DIR, config.PAPER_DIR, config.QUOTA_DIR):
        for f in d.glob("*"):
            f.unlink()
    yield


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """デモモードの擬似待ち時間をなくしてテストを速くする。

    mock.time は標準の time モジュールそのものなので、time.sleep を差し替えるとテスト側の待機まで消える。
    mock モジュールが参照する time だけを差し替える。
    """
    from app import mock

    monkeypatch.setattr(mock, "time", SimpleNamespace(sleep=lambda _s: None))
