# TextileBill API Contract Documentation

**Version:** 1.0.0  
**Last Updated:** March 21, 2026  
**Base URL:** `http://localhost:3001/api` (development) or your production URL

---

## Table of Contents
- [Authentication](#authentication)
- [Request/Response Format](#requestresponse-format)
- [Auth Endpoints](#auth-endpoints)
- [Company Endpoints](#company-endpoints)
- [Invoice Endpoints](#invoice-endpoints)
- [Product Endpoints](#product-endpoints)
- [Account Endpoints](#account-endpoints)
- [Error Handling](#error-handling)

---

## Authentication

### Headers Required
```http
Cookie: SESSION_TOKEN_COOKIE=<jwt_access_token>
X-Company-Id: <company_uuid>
Content-Type: application/json
```

### Token Flow
1. **Access Token**: 15 minutes expiry, stored in httpOnly cookie
2. **Refresh Token**: 7 days expiry, stored in httpOnly cookie
3. **Auto-refresh**: Frontend interceptor handles 401 responses

---

## Request/Response Format

### Success Response
```json
{
  "data": {
    /* Response payload */
  },
  "meta": {
    "timestamp": "2026-03-21T08:00:00Z"
  }
}
```

### Error Response
```json
{
  "statusCode": 400,
  "message": "User-friendly error message",
  "error": "Bad Request",
  "meta": {
    "timestamp": "2026-03-21T08:00:00Z",
    "path": "/api/invoices"
  }
}
```

---

## Auth Endpoints

### POST `/auth/login`
**Description:** Login with email/username and password  
**Authentication:** None required  
**Request:**
```json
{
  "identifier": "user@example.com",
  "password": "SecurePassword123!"
}
```
**Response:**
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "username": "username",
      "firstName": "John",
      "lastName": "Doe",
      "role": "STAFF"
    },
    "accessToken": "jwt_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

### POST `/auth/otp/request`
**Description:** Request OTP for login or verification  
**Authentication:** None required  
**Request:**
```json
{
  "identifier": "user@example.com",
  "channel": "EMAIL",
  "purpose": "LOGIN"
}
```
**Response:**
```json
{
  "data": {
    "message": "OTP sent successfully",
    "requestId": "uuid",
    "channel": "EMAIL",
    "targetHint": "u***@example.com",
    "expiresInSeconds": 300,
    "resendCooldownSeconds": 60
  }
}
```

### POST `/auth/otp/verify`
**Description:** Verify OTP code  
**Authentication:** None required  
**Request:**
```json
{
  "requestId": "uuid",
  "otpCode": "123456",
  "identifier": "user@example.com"
}
```

### POST `/auth/refresh`
**Description:** Refresh access token  
**Authentication:** Refresh token in cookie  
**Response:** New access token in cookie

### POST `/auth/logout`
**Description:** Logout and invalidate tokens  
**Authentication:** Required  
**Response:** Success message

### POST `/auth/forgot-password`
**Description:** Request password reset  
**Request:**
```json
{
  "email": "user@example.com"
}
```

### POST `/auth/reset-password`
**Description:** Reset password with token  
**Request:**
```json
{
  "token": "reset_token",
  "newPassword": "NewSecurePassword123!"
}
```

---

## Company Endpoints

### GET `/company`
**Description:** List all companies for current user  
**Authentication:** Required  
**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Company Name",
      "gstin": "22AAAAA0000A1Z5",
      "address": "123 Street",
      "city": "Mumbai",
      "state": "Maharashtra",
      "isActive": true
    }
  ]
}
```

### GET `/company/:id`
**Description:** Get company details  
**Authentication:** Required + Company access  

### GET `/company/:id/settings`
**Description:** Get company settings  
**Response:**
```json
{
  "data": {
    "id": "uuid",
    "companyId": "uuid",
    "taxMode": "GST",
    "enableStock": true,
    "enableMultiCurrency": false,
    "defaultFinancialYearId": "uuid"
  }
}
```

### PATCH `/company/:id/settings`
**Description:** Update company settings  
**Request:** Partial settings object

---

## Invoice Endpoints

### GET `/invoice`
**Description:** List invoices with filters  
**Query Parameters:**
- `type`: SALE | PURCHASE | QUOTATION | CHALLAN | etc.
- `status`: ACTIVE | DRAFT | PAID | PARTIALLY_PAID | CANCELLED
- `page`: number (default: 1)
- `limit`: number (default: 20)
- `search`: string (invoice number or party name)

**Response:**
```json
{
  "data": {
    "invoices": [
      {
        "id": "uuid",
        "invoiceNumber": "INV-001",
        "invoiceType": "SALE",
        "invoiceDate": "2026-03-21",
        "status": "ACTIVE",
        "account": {
          "id": "uuid",
          "name": "Customer Name"
        },
        "totalAmount": 10000.00,
        "paidAmount": 5000.00,
        "balanceAmount": 5000.00
      }
    ],
    "pagination": {
      "total": 100,
      "page": 1,
      "limit": 20,
      "totalPages": 5
    }
  }
}
```

### GET `/invoice/:id`
**Description:** Get invoice details with items  
**Response:**
```json
{
  "data": {
    "id": "uuid",
    "invoiceNumber": "INV-001",
    "invoiceType": "SALE",
    "invoiceDate": "2026-03-21",
    "dueDate": "2026-04-21",
    "status": "ACTIVE",
    "account": { /* account details */ },
    "items": [
      {
        "id": "uuid",
        "product": { "id": "uuid", "name": "Product" },
        "quantity": 10,
        "rate": 100.00,
        "amount": 1000.00,
        "taxAmount": 180.00,
        "total": 1180.00
      }
    ],
    "subtotal": 1000.00,
    "taxAmount": 180.00,
    "totalAmount": 1180.00,
    "paidAmount": 0.00,
    "balanceAmount": 1180.00
  }
}
```

### POST `/invoice`
**Description:** Create new invoice  
**Request:**
```json
{
  "invoiceType": "SALE",
  "invoiceDate": "2026-03-21",
  "accountId": "uuid",
  "dueDate": "2026-04-21",
  "items": [
    {
      "productId": "uuid",
      "quantity": 10,
      "rate": 100.00,
      "taxRate": 18.00
    }
  ],
  "notes": "Optional notes"
}
```

### PATCH `/invoice/:id`
**Description:** Update invoice  
**Request:** Partial invoice object

### DELETE `/invoice/:id/cancel`
**Description:** Cancel invoice (soft delete)

### POST `/invoice/:id/payment`
**Description:** Record payment  
**Request:**
```json
{
  "amount": 5000.00,
  "paymentDate": "2026-03-21",
  "paymentMode": "CASH",
  "referenceNumber": "REF123",
  "notes": "Partial payment"
}
```

---

## Product Endpoints

### GET `/product`
**Description:** List products  
**Query Parameters:**
- `page`, `limit`, `search`
- `categoryId`: filter by category
- `brandId`: filter by brand
- `isActive`: boolean

**Response:**
```json
{
  "data": {
    "products": [
      {
        "id": "uuid",
        "name": "Product Name",
        "code": "PROD001",
        "category": { "id": "uuid", "name": "Category" },
        "brand": { "id": "uuid", "name": "Brand" },
        "sellingPrice": 1000.00,
        "purchasePrice": 800.00,
        "gstRate": 18.00,
        "isActive": true
      }
    ],
    "pagination": { /* ... */ }
  }
}
```

### POST `/product`
**Description:** Create product  
**Request:**
```json
{
  "name": "Product Name",
  "code": "PROD001",
  "categoryId": "uuid",
  "brandId": "uuid",
  "sellingPrice": 1000.00,
  "purchasePrice": 800.00,
  "gstRate": 18.00,
  "uomId": "uuid"
}
```

### PATCH `/product/:id`
**Description:** Update product

### DELETE `/product/:id`
**Description:** Deactivate product (soft delete)

---

## Account Endpoints

### GET `/account`
**Description:** List accounts (customers/suppliers)  
**Query Parameters:**
- `page`, `limit`, `search`
- `accountGroupId`: filter by group
- `isActive`: boolean

**Response:**
```json
{
  "data": {
    "accounts": [
      {
        "id": "uuid",
        "name": "Customer/Supplier Name",
        "gstin": "22AAAAA0000A1Z5",
        "accountGroup": { "id": "uuid", "name": "Sundry Debtors" },
        "city": "Mumbai",
        "state": "Maharashtra",
        "phone": "9876543210",
        "email": "contact@example.com",
        "openingBalance": 0.00,
        "currentBalance": 10000.00,
        "isActive": true
      }
    ],
    "pagination": { /* ... */ }
  }
}
```

### POST `/account`
**Description:** Create account  
**Request:**
```json
{
  "name": "Customer Name",
  "accountGroupId": "uuid",
  "gstin": "22AAAAA0000A1Z5",
  "address": "123 Street",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400001",
  "phone": "9876543210",
  "email": "contact@example.com"
}
```

---

## Error Handling

### Common Error Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 400 | Bad Request | Invalid input, validation errors |
| 401 | Unauthorized | Token expired, invalid token |
| 403 | Forbidden | Insufficient permissions, account inactive |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate entry, concurrent modification |
| 422 | Unprocessable Entity | Business logic validation failed |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

### Error Response Example
```json
{
  "statusCode": 422,
  "message": "Invoice number already exists for this company",
  "error": "Unprocessable Entity",
  "meta": {
    "timestamp": "2026-03-21T08:00:00Z",
    "path": "/api/invoice"
  }
}
```

### Validation Errors
```json
{
  "statusCode": 400,
  "message": ["email must be a valid email", "password is required"],
  "error": "Bad Request"
}
```

---

## Rate Limiting

- **Auth endpoints:** 5 requests per minute per IP
- **General API:** 100 requests per minute per user
- **429 Response:** Wait for `Retry-After` header value (seconds)

---

## Pagination

All list endpoints support pagination:

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

**Response:**
```json
{
  "data": { /* items */ },
  "pagination": {
    "total": 500,
    "page": 1,
    "limit": 20,
    "totalPages": 25,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

---

## WebSocket Events (Future)

Coming soon: Real-time updates for invoice status, payments, stock movements.

---

**For detailed backend implementation, see backend documentation.**  
**For frontend integration examples, see frontend documentation.**
