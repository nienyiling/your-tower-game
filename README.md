# Tower Game

This repository contains a simple browser-based tower stacking game.

## Running locally

Because the project uses ES modules, you'll need to serve the files over HTTP.
Run a quick server from the repository root:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000/towergame/index.html](http://localhost:8000/towergame/index.html) in your browser.

The repository root also contains a small `index.html` that simply redirects
to the game directory. This makes GitHub Pages and other static hosting services
load the game automatically at the project root URL.


