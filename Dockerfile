# Dockerfile - Purposely Vulnerable Container
FROM ubuntu:16.04

# Install vulnerable Python dependencies
RUN apt-get update && apt-get install -y python-pip && \
    pip install requests==2.19.1 flask==0.12.0 && \
    rm -rf /var/lib/apt/lists/*

# Add an insecure user with weak permissions
RUN useradd -ms /bin/bash user && echo "user:password" | chpasswd && usermod -aG sudo user

# Expose insecure ports
EXPOSE 22 80

# Start vulnerable services
CMD ["/bin/bash", "-c", "service ssh start && flask run --host=0.0.0.0"]
