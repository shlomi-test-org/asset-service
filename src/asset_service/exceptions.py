from jit_utils.requests.exceptions import JitApiException


class AssetServiceApiException(JitApiException):
    """Base exception for Asset service API exception."""


class RequestValidationException(AssetServiceApiException):
    """Exception raised when the API request validation fails in the asset service backend."""
    pass


class AssetNotFoundException(AssetServiceApiException):
    """Exception raised when the asset is not found in the asset service backend."""
    pass


class UnhandledException(AssetServiceApiException):
    """Exception raised when the asset service backend returns an error that is not specified in the above."""
    pass
