#!/usr/bin/env python3
"""Build an installable Core archive with one plugin root and reproducible entries."""
from pathlib import Path
import hashlib
import re
import zipfile

root = Path(__file__).resolve().parents[1]
plugin = root / 'wordpress/fondation-kenda-core'
version = re.search(r"define\('FKC_VERSION', '([^']+)'\)", (plugin / 'fondation-kenda-core.php').read_text())[1]
output = root / 'artifacts' / f'fondation-kenda-core-{version}.zip'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(plugin.rglob('*')):
        if path.is_file():
            info = zipfile.ZipInfo(path.relative_to(plugin.parent).as_posix(), date_time=(2026, 11, 13, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert f'fondation-kenda-core/fondation-kenda-core.php' in archive.namelist()
print(output)
print('SHA256', hashlib.sha256(output.read_bytes()).hexdigest())
