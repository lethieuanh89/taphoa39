import os

# KiotViet credentials (from environment)
UserName = os.getenv('KIOTVIET_USER')
LatestBranchId = os.getenv('KIOTVIET_BRANCH_ID')
Password = os.getenv('KIOTVIET_PASSWORD')
retailer = os. getenv('KIOTVIET_RETAILER')

# Firebase (service account JSON as string)
FIREBASE_SERVICE_ACCOUNT_KEY = os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY')