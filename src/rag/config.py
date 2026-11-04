"""Central settings, loaded from environment variables / .env."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""

    pinecone_api_key: str = ""
    pinecone_index: str = "godot-docs"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"

    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    chat_model: str = "gpt-4o-mini"

    godot_docs_repo: str = "https://github.com/godotengine/godot-docs.git"
    godot_docs_branch: str = "stable"
    docs_base_url: str = "https://docs.godotengine.org/en/stable"
    data_dir: Path = Path("data")

    top_k: int = 5

    @property
    def docs_checkout_dir(self) -> Path:
        return self.data_dir / "godot-docs"

    @property
    def documents_path(self) -> Path:
        return self.data_dir / "documents.jsonl"

    @property
    def manifest_path(self) -> Path:
        """What's currently in the index: page path -> content hash + chunk count."""
        return self.data_dir / "index_manifest.json"


settings = Settings()
