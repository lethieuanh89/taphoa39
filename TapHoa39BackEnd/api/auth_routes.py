from flask import Blueprint, request, jsonify
from functools import wraps
from Utility.firebase_admin_setup import verify_firebase_token
from Utility.user_management import UserManager
from Utility.get_env import UserName, Password, LatestBranchId, retailer
from FromKiotViet.get_authorization import get_authen_with_credentials

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
user_manager = UserManager()


def require_auth(f):
    """Decorator to require Firebase authentication for routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers. get('Authorization')
        
        if not auth_header or not auth_header. startswith('Bearer '):
            return jsonify({"error": "Missing or invalid authorization header"}), 401
        
        token = auth_header. split('Bearer ')[1]
        
        try:
            decoded_token = verify_firebase_token(token)
            request.user = decoded_token
            return f(*args, **kwargs)
        except ValueError as e:
            return jsonify({"error": str(e)}), 401
    
    return decorated_function


@auth_bp.route('/verify-phone', methods=['POST'])
def verify_phone():
    """
    Check if phone number is allowed before sending OTP.
    Called before Firebase sends SMS. 
    """
    data = request.get_json()
    phone_number = data. get('phone_number', '').replace(" ", "").replace("-", "")
    
    if not phone_number:
        return jsonify({"error": "Phone number is required"}), 400
    
    if not user_manager.is_phone_allowed(phone_number):
        return jsonify({
            "error": "Số điện thoại không được phép đăng nhập",
            "allowed": False
        }), 403
    
    return jsonify({
        "message": "Phone number is allowed",
        "allowed": True
    }), 200


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Complete login after Firebase phone authentication.
    Exchange Firebase ID token for app tokens.
    """
    data = request. get_json()
    firebase_id_token = data. get('id_token')
    
    if not firebase_id_token:
        return jsonify({"error": "Firebase ID token is required"}), 400
    
    try:
        # Verify Firebase token
        decoded_token = verify_firebase_token(firebase_id_token)
        firebase_uid = decoded_token['uid']
        phone_number = decoded_token. get('phone_number', '')
        
        # Check if phone is allowed
        if not user_manager.is_phone_allowed(phone_number):
            return jsonify({"error": "Số điện thoại không được phép đăng nhập"}), 403
        
        # Get or create user in Firestore
        user = user_manager.get_or_create_user(phone_number, firebase_uid)
        
        # Generate refresh token
        refresh_token = user_manager.generate_refresh_token(firebase_uid)
        
        # Get KiotViet token (using environment credentials)
        kiotviet_token = get_authen_with_credentials(UserName, Password, LatestBranchId, retailer)
        
        return jsonify({
            "success": True,
            "user": {
                "uid": firebase_uid,
                "phone_number": phone_number
            },
            "refresh_token": refresh_token,
            "kiotviet": {
                "access_token": kiotviet_token,
                "retailer": retailer,
                "branch_id": LatestBranchId
            }
        }), 200
        
    except ValueError as e:
        return jsonify({"error": str(e)}), 401


@auth_bp. route('/refresh', methods=['POST'])
def refresh_token():
    """
    Refresh authentication using refresh token.
    Returns new KiotViet access token.
    """
    data = request. get_json()
    refresh_token_value = data.get('refresh_token')
    
    if not refresh_token_value:
        return jsonify({"error": "Refresh token is required"}), 400
    
    # Validate refresh token
    firebase_uid = user_manager.validate_refresh_token(refresh_token_value)
    
    if not firebase_uid:
        return jsonify({"error": "Invalid or expired refresh token"}), 401
    
    # Get fresh KiotViet token
    kiotviet_token = get_authen_with_credentials(UserName, Password, LatestBranchId, retailer)
    
    return jsonify({
        "success": True,
        "kiotviet": {
            "access_token": kiotviet_token,
            "retailer": retailer,
            "branch_id": LatestBranchId
        }
    }), 200


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Logout and revoke refresh token."""
    data = request.get_json()
    refresh_token_value = data.get('refresh_token')
    
    if refresh_token_value:
        user_manager.revoke_refresh_token(refresh_token_value)
    
    return jsonify({"success": True, "message": "Logged out successfully"}), 200


@auth_bp.route('/me', methods=['GET'])
@require_auth
def get_current_user():
    """Get current authenticated user info."""
    return jsonify({
        "uid": request.user['uid'],
        "phone_number": request.user. get('phone_number', '')
    }), 200