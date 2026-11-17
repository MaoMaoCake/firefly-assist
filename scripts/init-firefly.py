"""Create local fixture credentials without overwriting an existing installation."""
import os
from pathlib import Path
import secrets

path = Path(__file__).resolve().parent.parent / '.env.firefly'
password = secrets.token_hex(24)
try:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print('Existing .env.firefly preserved.')
else:
    with os.fdopen(descriptor, 'w') as output:
        output.write(
            f'APP_KEY={secrets.token_hex(16)}\n'
            f'DB_PASSWORD={password}\n'
            f'MARIADB_PASSWORD={password}\n'
            f'MARIADB_ROOT_PASSWORD={secrets.token_hex(24)}\n'
        )
    print('Created .env.firefly with generated local credentials.')
