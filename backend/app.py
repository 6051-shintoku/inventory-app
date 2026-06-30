from contextlib import asynccontextmanager
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select

from database import create_db_and_tables, get_session
from models import Product, StockLog


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


class ThresholdUpdate(BaseModel):
    threshold: int


def create_stock_log(session: Session, product_id: int, change_quantity: int, action_type: str) -> StockLog:
    stock_log = StockLog(
        product_id=product_id,
        change_quantity=change_quantity,
        action_type=action_type,
    )
    session.add(stock_log)
    return stock_log


def resolve_action_type(change_quantity: int) -> str:
    if change_quantity > 0:
        return "入庫"
    if change_quantity < 0:
        return "出庫"
    return "在庫調整"


@app.post("/products", response_model=Product, status_code=201)
def create_product(product: Product, session: SessionDep):
    """商品を新規追加する"""
    session.add(product)
    session.flush()
    create_stock_log(
        session,
        product_id=product.id,
        change_quantity=product.stock_quantity,
        action_type="新規登録",
    )
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
    create_stock_log(
        session,
        product_id=product.id,
        change_quantity=body.change_quantity,
        action_type=resolve_action_type(body.change_quantity),
    )
    session.commit()
    session.refresh(product)
    return product


@app.put("/products/{product_id}/threshold", response_model=Product)
def update_threshold(product_id: int, body: ThresholdUpdate, session: SessionDep):
    """指定した商品のしきい値を更新する"""
    if body.threshold < 0:
        raise HTTPException(status_code=400, detail="しきい値は0以上で指定してください")

    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="商品が見つかりません")

    product.threshold = body.threshold
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.get("/stocklogs", response_model=list[StockLog])
def list_stocklogs(session: SessionDep, product_id: Optional[int] = None):
    """入出庫履歴を新しい順で取得する"""
    query = select(StockLog).order_by(StockLog.timestamp.desc(), StockLog.id.desc())

    if product_id is not None:
        query = query.where(StockLog.product_id == product_id)

    stocklogs = session.exec(query).all()
    return stocklogs
