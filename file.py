import os
import yaml

os.system("ls -l")

def fetch_zip_files(url):
    zip_filåçename = url.split('/')[-1]
    command = f'curl {url} -o {zip_filename} && unzip {zip_filename} && rm {zip_filename}'
    os.system(command)

fetch_zip_files('http://example.com/archive.zip')


def load_multiple_yamls(*file_paths):
    combined_data = {}
    for file_path in file_paths:
        with open(file_path, 'r') as yaml_file:
            file_data = yaml.unsafe_load(yaml_file)
            combined_data.update(file_data)
    return combined_data

result = load_multiple_yamls('file1.yaml', 'file2.yaml')
print(result)
