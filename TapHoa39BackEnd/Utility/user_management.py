from datetime import datetime, timedelta
from typing import Optional
import secrets
import hashlib
from . firebase_admin_setup import get_firestore_client, verify_firebase_token, get_user_by_phone


# Allowed phone numbers (whitelist)
ALLOWED_PHONE_NUMBERS = [
    "+84786185405"  # First account
]


class UserManager:
    """Manage user sessions and tokens in Firestore."""
    
    COLLECTION_NAME = "users"
    SESSIONS_COLLECTION = "sessions"
    REFRESH_TOKEN_EXPIRY_DAYS = 30
    
    def __init__(self):
        self.db = get_firestore_client()
    
    def is_phone_allowed(self, phone_number: str) -> bool:
        """Check if phone number is in the allowed list."""
        # Normalize phone number (remove spaces)
        normalized = phone_number.replace(" ", ""). replace("-", "")
        return normalized in ALLOWED_PHONE_NUMBERS
    
    def get_or_create_user(self, phone_number: str, firebase_uid: str) -> dict:
        """
        Get existing user or create new user document in Firestore. 
        
        Args:
            phone_number: User's phone number
            firebase_uid: Firebase Authentication UID
            
        Returns:
            User document data
        """
        user_ref = self.db. collection(self. COLLECTION_NAME). document(firebase_uid)
        user_doc = user_ref. get()
        
        if user_doc.exists:
            # Update last login
            user_ref.update({
                "last_login": datetime.utcnow(),
                "updated_at": datetime. utcnow()
            })
            return user_doc. to_dict()
        else:
            # Create new user
            user_data = {
                "phone_number": phone_number,
                "firebase_uid": firebase_uid,
                "created_at": datetime.utcnow(),
                "updated_at": datetime. utcnow(),
                "last_login": datetime.utcnow(),
                "is_active": True
            }
            user_ref.set(user_data)
            return user_data
    
    def generate_refresh_token(self, firebase_uid: str) -> str:
        """
        Generate and store a secure refresh token.
        
        Args:
            firebase_uid: Firebase Authentication UID
            
        Returns:
            Refresh token string
        """
        # Generate secure random token
        refresh_token = secrets. token_urlsafe(64)
        
        # Hash token for storage (never store plain tokens)
        token_hash = hashlib. sha256(refresh_token.encode()).hexdigest()
        
        # Store in Firestore
        session_ref = self. db.collection(self.SESSIONS_COLLECTION).document()
        session_data = {
            "user_id": firebase_uid,
            "token_hash": token_hash,
            "created_at": datetime. utcnow(),
            "expires_at": datetime.utcnow() + timedelta(days=self.REFRESH_TOKEN_EXPIRY_DAYS),
            "is_valid": True,
            "user_agent": "",  # Can be set from request headers
            "ip_address": ""   # Can be set from request
        }
        session_ref.set(session_data)
        
        return refresh_token
    
    def validate_refresh_token(self, refresh_token: str) -> Optional[str]:
        """
        Validate refresh token and return user ID if valid.
        
        Args:
            refresh_token: Refresh token to validate
            
        Returns:
            Firebase UID if valid, None otherwise
        """
        token_hash = hashlib.sha256(refresh_token.encode()). hexdigest()
        
        # Query for valid session
        sessions_ref = self. db.collection(self.SESSIONS_COLLECTION)
        query = sessions_ref. where("token_hash", "==", token_hash). where("is_valid", "==", True). limit(1)
        
        docs = query.stream()
        for doc in docs:
            session = doc.to_dict()
            
            # Check expiration
            if session["expires_at"]. replace(tzinfo=None) < datetime.utcnow():
                # Token expired, invalidate it
                doc.reference.update({"is_valid": False})
                return None
            
            return session["user_id"]
        
        return None
    
    def revoke_refresh_token(self, refresh_token: str) -> bool:
        """
        Revoke a refresh token (for logout).
        
        Args:
            refresh_token: Refresh token to revoke
            
        Returns:
            True if token was found and revoked
        """
        token_hash = hashlib.sha256(refresh_token.encode()). hexdigest()
        
        sessions_ref = self. db.collection(self.SESSIONS_COLLECTION)
        query = sessions_ref. where("token_hash", "==", token_hash).limit(1)
        
        docs = query.stream()
        for doc in docs:
            doc.reference.update({
                "is_valid": False,
                "revoked_at": datetime.utcnow()
            })
            return True
        
        return False
    
    def revoke_all_user_sessions(self, firebase_uid: str) -> int:
        """
        Revoke all refresh tokens for a user (security measure).
        
        Args:
            firebase_uid: Firebase Authentication UID
            
        Returns:
            Number of sessions revoked
        """
        sessions_ref = self.db. collection(self. SESSIONS_COLLECTION)
        query = sessions_ref.where("user_id", "==", firebase_uid).where("is_valid", "==", True)
        
        count = 0
        docs = query.stream()
        for doc in docs:
            doc.reference.update({
                "is_valid": False,
                "revoked_at": datetime. utcnow()
            })
            count += 1
        
        return count