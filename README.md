# Asset Service
[![codecov](https://codecov.io/gh/jitsecurity/asset-service/branch/main/graph/badge.svg?token=8I4WSZE5C1)](https://codecov.io/gh/jitsecurity/asset-service)

## Run the mock
### Using docker:
Build and run the mock docker:
```bash
docker build -f ./service_mocks/dockerfile-dev -t fastapi ./service_mocks/
docker run -d --name mock-service -p 8088:80 fastapi
```
Generate swagger and try the mock:
http://127.0.0.1:8088/docs#/

### Command line
For fast debug, it is easier to run the `main.py` directly from the terminal:
```bash
cd service_mocks/app
uvicorn main:app --reload
```
Generate swagger and try the mock:
http://127.0.0.1:8000/docs#/


## Deploy locally and run tests
Run service locally:
```bash
npm install
serverless deploy --stage test
register-service --service-name asset-service --stage test
```
Run _all_ tests:
```bash
pip install -r requirements-test.txt
pytest -s
```

