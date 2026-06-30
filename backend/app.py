from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select

from database import create_db_and_tables, get_session
from models import Product


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(title="在庫管理API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SessionDep = Annotated[Session, Depends(get_session)]


class StockUpdate(BaseModel):
    change_quantity: int


@app.post("/products", response_model=Product, status_code=201)
def create_product(product: Product, session: SessionDep):
    """商品を新規追加する"""
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.get("/products", response_model=list[Product])
def list_products(session: SessionDep):
    """全商品の一覧を取得する"""
    products = session.exec(select(Product)).all()
    return products


@app.put("/products/{product_id}/stock", response_model=Product)
def update_stock(product_id: int, body: StockUpdate, session: SessionDep):
    """指定した商品の在庫数を増減させる"""
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="商品が見つかりません")
    product.stock_quantity += body.change_quantity
    session.add(product)
    session.commit()
    session.refresh(product)
    return product
