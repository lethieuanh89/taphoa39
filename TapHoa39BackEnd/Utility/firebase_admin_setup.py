import firebase_admin
from firebase_admin import credentials, auth, firestore
import os
import json


def init_firebase():
    """Initialize Firebase Admin SDK with service account from environment variable."""
    if firebase_admin._apps:
        return firebase_admin.get_app()
    
    # Get Firebase service account from environment variable
    firebase_credentials_json = os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY')
    
    if not firebase_credentials_json:
        raise ValueError("FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set")
    
    try:
        # Parse JSON string to dictionary
        cred_dict = json.loads(firebase_credentials_json)
        cred = credentials.Certificate(cred_dict)
        return firebase_admin.initialize_app(cred)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in FIREBASE_SERVICE_ACCOUNT_KEY: {e}")


def get_firestore_client():
    """Get Firestore client instance."""
    init_firebase()
    return firestore.client()


def verify_firebase_token(id_token: str) -> dict:
    """
    Verify Firebase ID token and return decoded token data.
    
    Args:
        id_token: Firebase ID token from client
        
    Returns:
        Decoded token data containing user info
        
    Raises:
        auth.InvalidIdTokenError: If token is invalid
        auth.ExpiredIdTokenError: If token has expired
    """
    init_firebase()
    try:
        decoded_token = auth. verify_id_token(id_token, check_revoked=True)
        return decoded_token
    except auth. RevokedIdTokenError:
        raise ValueError("Token has been revoked")
    except auth.ExpiredIdTokenError:
        raise ValueError("Token has expired")
    except auth.InvalidIdTokenError:
        raise ValueError("Invalid token")


def get_user_by_phone(phone_number: str):
    """
    Get Firebase user by phone number. 
    
    Args:
        phone_number: Phone number in E.164 format (e.g., +84786185405)
        
    Returns:
        Firebase UserRecord or None if not found
    """
    init_firebase()
    try:
        user = auth.get_user_by_phone_number(phone_number)
        return user
    except auth.UserNotFoundError:
        return None


def create_custom_token(uid: str, additional_claims: dict = None) -> str:
    """
    Create a custom token for a user.
    
    Args:
        uid: User's Firebase UID
        additional_claims: Optional additional claims to include in token
        
    Returns:
        Custom token string
    """
    init_firebase()
    return auth.create_custom_token(uid, additional_claims)