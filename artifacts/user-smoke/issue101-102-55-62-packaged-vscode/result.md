# Issue 101 102 55 62 packaged VS Code smoke

- vsixPath: <vsix>
- codePath: code
- scenarioCount: 3
- totalElapsedMs: 22163

| scenario | expected items | found items | expected raw matches | raw matches | scan issues | scan ms | elapsed ms | process rows |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: |
| default_text_scan_hidden_files | 12 | 12 | 20 | 20 | 0 | 72 | 3004 | 7 |
| explicit_include_dotfiles | 8 | 8 | 8 | 8 | 0 | 41 | 3002 | 7 |
| hidden_permission_recovery | 8 | 8 | 16 | 16 | 1 | 51 | 3003 | 7 |
