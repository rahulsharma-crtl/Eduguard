"""Run additive API migrations before starting multiple workers. Back up production first."""
from backend.app import Settings
from backend.store import Store
if __name__=='__main__':
    store=Store(Settings.from_env().database_url)
    store.engine.dispose()
    print('Additive schema migrations complete. Existing records retained.')
