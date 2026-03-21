$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001/api'

function Wait-Server {
  param([int]$TimeoutSec = 90)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    try {
      $null = Invoke-WebRequest -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"x","password":"y"}' -TimeoutSec 3
    } catch {
      if ($_.Exception.Response -and ($_.Exception.Response.StatusCode.value__ -in 400,401)) { return }
    }
    Start-Sleep -Milliseconds 900
  }
  throw 'Server did not become ready in time.'
}

function Api {
  param([string]$Method,[string]$Path,[object]$Body,[string]$Token,[string]$CompanyId)
  $headers = @{}
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  if ($CompanyId) { $headers['x-company-id'] = $CompanyId }
  $uri = "$base/$Path"
  try {
    if ($null -ne $Body) {
      $resp = Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 10)
      if ($resp.PSObject.Properties.Name -contains 'data') { return $resp.data }
      return $resp
    }
    $resp = Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers
    if ($resp.PSObject.Properties.Name -contains 'data') { return $resp.data }
    return $resp
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $respText = ''
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $respText = $reader.ReadToEnd()
    } catch {}
    return [pscustomobject]@{ __error = $true; status = $status; body = $respText }
  }
}

$result = [ordered]@{}
Wait-Server

$super = Api -Method 'Post' -Path 'auth/login' -Body @{ username='superadmin'; password='Admin@123456' }
if ($super.__error) { throw "Superadmin login failed: $($super.status) $($super.body)" }
$superToken = $super.accessToken
$result.superadminLogin = 'PASS'

$plans = Api -Method 'Get' -Path 'admin/plans' -Token $superToken
$planId = if ($plans -and $plans.Count -gt 0) { $plans[0].id } else { $null }

$nonce = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$slug = "autotenant$nonce"
$tenant = Api -Method 'Post' -Path 'admin/tenants' -Body @{
  name = "Auto Tenant $nonce"; slug = $slug; gstin = '24ABCDE1234F1Z5'; address='Ring Road'; city='Surat'; state='Gujarat'; pincode='395001'; phone='+919876543210';
  email = "${slug}@example.com"; adminFirstName='Auto'; adminLastName='Admin'; password='new.tenant.'; planId=$planId
} -Token $superToken
if ($tenant.__error) { throw "Tenant creation failed: $($tenant.status) $($tenant.body)" }
$result.createTenant = 'PASS'

$tenantAdminLogin = Api -Method 'Post' -Path 'auth/login' -Body @{ username=$tenant.user.username; password=$tenant.tempPassword }
if ($tenantAdminLogin.__error) { throw "Tenant admin login failed: $($tenantAdminLogin.status) $($tenantAdminLogin.body)" }
$tenantAdminToken = $tenantAdminLogin.accessToken
$result.tenantAdminLogin = 'PASS'

$invalidUser = Api -Method 'Post' -Path 'users' -Token $tenantAdminToken -Body @{ email="baduser$nonce@example.com"; password='TempPass@123'; role='TENANT_ADMIN'; firstName='Bad'; lastName='Phone'; phone='+91@123' }
$result.invalidPhoneValidation = if ($invalidUser.__error -and $invalidUser.status -eq 400) { 'PASS' } else { 'FAIL' }

$newUserEmail = "newuser$nonce@example.com"
$newUserPass = 'TempPass@123'
$newUser = Api -Method 'Post' -Path 'users' -Token $tenantAdminToken -Body @{ email=$newUserEmail; password=$newUserPass; role='TENANT_ADMIN'; firstName='New'; lastName='User'; phone='+919999888877'; companyIds=@($tenant.company.id) }
if ($newUser.__error) { throw "Create new user failed: $($newUser.status) $($newUser.body)" }
$result.createNewUser = 'PASS'

$newLogin = Api -Method 'Post' -Path 'auth/login' -Body @{ username=$newUserEmail; password=$newUserPass }
if ($newLogin.__error) { throw "New user login failed: $($newLogin.status) $($newLogin.body)" }
$newToken = $newLogin.accessToken
$result.newUserLogin = 'PASS'

$newCompany = Api -Method 'Post' -Path 'companies' -Token $newToken -Body @{ name="New User Co $nonce"; gstin='27ABCDE1234F1Z9'; city='Mumbai'; state='Maharashtra'; phone='+918888777766'; email="company$nonce@example.com" }
if ($newCompany.__error) { throw "Company create failed: $($newCompany.status) $($newCompany.body)" }
$companyId = $newCompany.id
$result.createCompany = 'PASS'

$badGstinUpdate = Api -Method 'Patch' -Path "companies/$companyId" -Token $newToken -Body @{ gstin='27AB@DE1234F1Z9' }
$result.invalidGstinValidation = if ($badGstinUpdate.__error -and $badGstinUpdate.status -eq 400) { 'PASS' } else { 'FAIL' }

$account = Api -Method 'Post' -Path 'accounts' -Token $newToken -CompanyId $companyId -Body @{ name="Customer $nonce"; phone='+917777666655'; email="customer$nonce@example.com"; city='Mumbai'; state='Maharashtra' }
if ($account.__error) { throw "Account create failed: $($account.status) $($account.body)" }
$result.createAccount = 'PASS'

$product = Api -Method 'Post' -Path 'products' -Token $newToken -CompanyId $companyId -Body @{ name="Fabric $nonce"; retailPrice=1200; buyingPrice=900; gstRate=5; type='GOODS'; gstConsiderAs='TAXABLE' }
if ($product.__error) { throw "Product create failed: $($product.status) $($product.body)" }
$result.createProduct = 'PASS'

$invoice = Api -Method 'Post' -Path 'invoices' -Token $newToken -CompanyId $companyId -Body @{ invoiceType='SALE'; invoiceDate=(Get-Date).ToString('yyyy-MM-dd'); accountId=$account.id; items=@(@{ productId=$product.id; quantity=2; rate=1200; gstRate=5 }) }
if ($invoice.__error) { throw "Invoice create failed: $($invoice.status) $($invoice.body)" }
$result.createInvoice = 'PASS'

$updateInv = Api -Method 'Put' -Path "invoices/$($invoice.id)" -Token $newToken -CompanyId $companyId -Body @{ narration='Updated via automation scenario' }
if ($updateInv.__error) { throw "Invoice update failed: $($updateInv.status) $($updateInv.body)" }
$result.updateInvoice = 'PASS'

$stockAdj = Api -Method 'Post' -Path 'accounting/stock-adjustments' -Token $newToken -CompanyId $companyId -Body @{ productId=$product.id; type='ADD'; quantity=5; reason='Initial stocking'; date=(Get-Date).ToString('yyyy-MM-dd') }
if ($stockAdj.__error) { throw "Stock update failed: $($stockAdj.status) $($stockAdj.body)" }
$result.updateStock = 'PASS'

$profileUpdate = Api -Method 'Patch' -Path 'users/me' -Token $newToken -Body @{ firstName='Updated'; lastName='User'; phone='+919123456789' }
if ($profileUpdate.__error) { throw "Profile update failed: $($profileUpdate.status) $($profileUpdate.body)" }
$result.updateProfile = 'PASS'

$tmpDir = 'E:\Billmanagment\backend\tmp-scenario'
if (-not (Test-Path $tmpDir)) { New-Item -Path $tmpDir -ItemType Directory | Out-Null }
$txtPath = Join-Path $tmpDir 'not-image.txt'; Set-Content -Path $txtPath -Value 'not an image'
$badUploadOut = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/users/me/avatar" -H "Authorization: Bearer $newToken" -F "file=@$txtPath;type=text/plain"
$result.avatarRejectNonImage = if ($badUploadOut -eq '400') { 'PASS' } else { "FAIL($badUploadOut)" }

$pngPath = Join-Path $tmpDir 'avatar.png'
[System.IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZB8kAAAAASUVORK5CYII='))
$goodUploadOut = curl.exe -s -o NUL -w "%{http_code}" -X POST "$base/users/me/avatar" -H "Authorization: Bearer $newToken" -F "file=@$pngPath;type=image/png"
$result.avatarUploadImage = if ($goodUploadOut -eq '201' -or $goodUploadOut -eq '200') { 'PASS' } else { "FAIL($goodUploadOut)" }

$resultPath = 'E:\Billmanagment\backend\scenario-result.json'
($result | ConvertTo-Json -Depth 10) | Set-Content $resultPath
Write-Output ("RESULT_FILE=" + $resultPath)
Write-Output ($result | ConvertTo-Json -Depth 10)


