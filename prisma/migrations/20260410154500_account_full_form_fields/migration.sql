ALTER TABLE "Party"
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "pincode" TEXT,
ADD COLUMN "contactPerson" TEXT;

ALTER TABLE "Account"
ADD COLUMN "searchCode" TEXT,
ADD COLUMN "gstType" TEXT,
ADD COLUMN "priceSelection" TEXT,
ADD COLUMN "openingBalanceType" TEXT,
ADD COLUMN "creditLimit" DECIMAL(14, 2),
ADD COLUMN "paymentDays" INTEGER,
ADD COLUMN "partyDiscountRate" DECIMAL(5, 2);
