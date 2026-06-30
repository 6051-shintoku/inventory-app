from typing import Optional
from sqlmodel import Field, SQLModel


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    category: str
    price: int
    stock_quantity: int = Field(default=0)
    threshold: int = Field(default=5)
