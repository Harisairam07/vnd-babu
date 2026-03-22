from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
import asyncio


class DatabaseManager:
  def __init__(self) -> None:
    self.client: AsyncIOMotorClient | None = None
    self.db: AsyncIOMotorDatabase | None = None
    self._setup_complete = False
    self._setup_lock = asyncio.Lock()

  async def connect(self, mongo_uri: str, database_name: str) -> None:
    self.client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=5000)
    self.db = self.client[database_name]

  async def close(self) -> None:
    if self.client:
      self.client.close()
    self.client = None
    self.db = None
    self._setup_complete = False


db_manager = DatabaseManager()
