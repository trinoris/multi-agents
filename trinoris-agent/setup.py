#!/usr/bin/env python3
"""
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
"""

from setuptools import setup, find_packages

setup(
    name="trinoris-coordination",
    version="0.1.0",
    description="Multi-agent coordination protocol CLI",
    author="TRINORIS",
    python_requires=">=3.9",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "trinoris_agent": ["templates/*"],
    },
    entry_points={
        "console_scripts": [
            "trinoris-agent=trinoris_agent.cli:main",
        ],
    },
    install_requires=[],
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
)
