"""QSH entrypoint shim — delegates to compiled main module."""
from qsh.main import main

if __name__ == "__main__":
    main()
