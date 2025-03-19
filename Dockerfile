FROM ubuntu:16.04

# Install vulnerable packages from old repos
RUN apt-get update && \
    apt-get install -y --allow-downgrades wget=1.17.1-1ubuntu1 openssl=1.0.2g-1ubuntu4 bash=4.3-14ubuntu1 && \
    rm -rf /var/lib/apt/lists/*

# Install vulnerable Python dependencies
RUN apt-get update && apt-get install -y --allow-downgrades python-pip && \
    pip install requests==2.19.1 flask==0.12.0 && \
    rm -rf /var/lib/apt/lists/*

# Add insecure user with weak permissions
RUN useradd -ms /bin/bash user && echo "user:password" | chpasswd && usermod -aG sudo user

# Expose insecure ports
EXPOSE 22 80

# Start vulnerable services
CMD ["/bin/bash", "-c", "service ssh start && flask run --host=0.0.0.0"]
