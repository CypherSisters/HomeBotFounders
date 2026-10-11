#!/usr/bin/env python3
"""
PuffPAI Setup Script
"""

from setuptools import setup, find_packages
import os

# Read README for long description
with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

# Read requirements
with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = [line.strip() for line in fh if line.strip() and not line.startswith("#")]

setup(
    name="puffpai",
    version="1.0.0",
    author="Cypher Sisters",
    author_email="307375596+CypherSisters@users.noreply.github.com",
    description="Privacy-Forward Personal AI - Offline AI assistant with smart home integration",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/CypherSisters/HomeBotFounders",
    project_urls={
        "Bug Reports": "https://github.com/CypherSisters/HomeBotFounders/issues",
        "Source": "https://github.com/CypherSisters/HomeBotFounders",
        "Documentation": "https://github.com/CypherSisters/HomeBotFounders/tree/main/docs",
    },
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: End Users/Desktop",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
        "Topic :: Home Automation",
        "License :: OSI Approved :: Apache Software License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Operating System :: POSIX :: Linux",
        "Operating System :: Microsoft :: Windows",
    ],
    python_requires=">=3.10",
    install_requires=requirements,
    extras_require={
        "dev": [
            "pytest>=7.4.0",
            "black>=23.0.0",
            "flake8>=6.1.0",
            "mypy>=1.5.0",
        ],
        "desktop": [
            "pyinstaller>=6.0.0",
        ],
        # Legacy embedding backend (all-MiniLM-L6-v2 via sentence-transformers).
        # Optional because it pulls PyTorch, which on Jetson/ARM64 must come
        # from NVIDIA's wheel index. The Orin appliance uses the Ollama
        # /api/embed backend instead — see src/puffpai/embeddings.py.
        "embeddings-legacy": [
            "sentence-transformers>=5.0.0,<6.0",
        ],
        # OCR for image uploads and scanned PDFs. Optional because both are
        # thin wrappers over system binaries that must be installed too:
        # pytesseract needs `tesseract-ocr`, pdf2image needs `poppler-utils`
        # (provision_orin.sh installs both). Without this extra, image OCR and
        # image-only-PDF extraction silently return nothing.
        # Second-stage device classifier (security/device_ml.py). Optional
        # because the module guards the import and returns UNKNOWN without it:
        # the shipped classifier is the OUI table alone.
        "ml": [
            "scikit-learn",
        ],
        "ocr": [
            "pytesseract>=0.3.10",
            "pdf2image>=1.17.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "puffpai=puffpai.cli:main",
            "puffpai-service=puffpai.service:run_service",
        ],
    },
    include_package_data=True,
    package_data={
        "puffpai": [
            "config/*.json.template",
            "config/*.txt",
            # Offline directions: the Texas towns lists.
            "maps_texas_places*.txt",
        ],
    },
)
