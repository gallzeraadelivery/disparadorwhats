#!/usr/bin/env python3
"""Snapshot SQLite online + mídias. Rodar como usuário com acesso ao volume."""
import sqlite3, pathlib, datetime, tempfile, tarfile, os
root=pathlib.Path(os.environ.get('DISPARAZAP_DIR','/opt/disparazap'))
dest=pathlib.Path(os.environ.get('DISPARAZAP_BACKUPS','/opt/backups/disparazap'))
dest.mkdir(parents=True,exist_ok=True,mode=0o700)
with tempfile.TemporaryDirectory() as tmp:
    snapshot=pathlib.Path(tmp)/'disparazap.sqlite'
    with sqlite3.connect(f'file:{root}/data/disparazap.sqlite?mode=ro',uri=True) as source, sqlite3.connect(snapshot) as target:
        source.backup(target)
    filename=dest/('disparazap-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.tar.gz')
    with tarfile.open(filename,'w:gz') as archive:
        archive.add(snapshot,arcname='disparazap.sqlite')
        archive.add(root/'data/media',arcname='media')
    filename.chmod(0o600)
    print(filename)
