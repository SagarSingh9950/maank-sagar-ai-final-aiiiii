$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host '=== Friday-pAI Windows verification ===' -ForegroundColor Cyan
Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"

npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }

npm test
if ($LASTEXITCODE -ne 0) { throw 'Automated tests failed.' }

npm run check:main
if ($LASTEXITCODE -ne 0) { throw 'Main-process syntax checks failed.' }

npm run lint
if ($LASTEXITCODE -ne 0) { throw 'ESLint failed.' }

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }

npm run test:api-smoke
if ($LASTEXITCODE -ne 0) { throw 'A configured live API smoke test failed.' }

Write-Host ''
Write-Host 'PASS: dependency install, tests, syntax, lint, production build and configured API smoke tests.' -ForegroundColor Green
Write-Host 'GUI restart check: launch the app, run one workflow, close the app fully, relaunch, then confirm Memory and workflow history are still present.' -ForegroundColor Yellow
