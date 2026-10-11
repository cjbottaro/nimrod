# Third-party notices

## Bundled VS Code themes

See [THEME_CATALOG_NOTICES.md](THEME_CATALOG_NOTICES.md) for the generated pinned
source revisions, authors and full license texts. Both notice files are included
in packaged apps. Nimrod adapts these resolved JSON snapshots through its
color-only importer; no extensions or upstream build scripts run.

## Legacy Gogh palette collection

Earlier development builds downloaded Gogh's public palette data on user request and adapted its
background/foreground and ANSI colors to UI and broad syntax roles.
No Gogh installers/scripts are downloaded or executed. Theme-author text is
retained in the catalog and saved palettes.

- Project: https://github.com/Gogh-Co/Gogh
- Catalog: https://raw.githubusercontent.com/Gogh-Co/Gogh/master/data/themes.json
- Upstream license: https://github.com/Gogh-Co/Gogh/blob/master/LICENSE-MIT
- Gogh offers MIT or Apache-2.0; Nimrod uses the MIT option.

MIT License

Copyright (c) 2024 Gogh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Tokyo Night and Osaka Jade palettes

Nimrod's built-in Tokyo Night and Osaka Jade themes adapt Omarchy's public palettes to this app's UI and broad syntax categories. They are not official Omarchy applications or complete editor themes. No Omarchy artwork is bundled.

- Omarchy project: https://github.com/omacom/omarchy
- Tokyo Night palette: https://github.com/omacom/omarchy/blob/04b374a989c49bdeda72542f194106ea0c3da3ff/themes/tokyo-night/colors.toml
- Osaka Jade palette: https://github.com/omacom/omarchy/blob/04b374a989c49bdeda72542f194106ea0c3da3ff/themes/osaka-jade/colors.toml
- Omarchy license: https://github.com/omacom/omarchy/blob/04b374a989c49bdeda72542f194106ea0c3da3ff/LICENSE
- Tokyo Night original author/project: Enkia, https://github.com/enkia/tokyo-night-vscode-theme
- Tokyo Night license: https://github.com/enkia/tokyo-night-vscode-theme/blob/master/LICENSE.txt
- Nimrod adaptations: `src/themes/tokyo-night.json`, `src/themes/osaka-jade.json`

The MIT License (MIT)

Copyright (c) David Heinemeier Hansson (Omarchy)

Copyright (c) 2018-present Enkia (Tokyo Night)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Dracula theme

Nimrod's built-in Dracula theme adapts the official Dracula palette to this app's UI and broad syntax-highlighting categories. It is not the complete VS Code theme or an official Dracula application.

- Project: https://draculatheme.com/
- Palette/source: https://github.com/dracula/visual-studio-code/blob/master/src/dracula.yml
- License: https://github.com/dracula/visual-studio-code/blob/master/LICENSE
- Nimrod adaptation: `src/themes/dracula.json`

The MIT License (MIT)

Copyright (c) 2016 Dracula Theme

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
