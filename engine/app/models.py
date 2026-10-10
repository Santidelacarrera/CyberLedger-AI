from enum import Enum
from pydantic import BaseModel, Field


class Action(str, Enum):
    PATCH_IN_PLACE = "patch_in_place"
    PATCH_AND_RIGHTSIZE = "patch_and_rightsize"
    REPLACE_CHEAPER = "replace_cheaper"
    DESTROY = "destroy"
    REVOKE_IDENTITY = "revoke_identity"
    THROTTLE_LLM = "throttle_llm"
    NO_ACTION = "no_action"


class Resource(BaseModel):
    id: str
    kind: str = "compute"  # compute | identity | secret | llm_usage
    monthly_cost: float = Field(ge=0)
    utilization: float = Field(ge=0, le=1, description="avg CPU/mem utilization 0-1")
    instance_type: str = "m5.xlarge"
    cheaper_instance_type: str | None = None
    cheaper_monthly_cost: float | None = Field(default=None, ge=0)
    production: bool = True
    idle_days: int = 0
    baseline_monthly_cost: float | None = Field(default=None, ge=0, description="expected cost for llm_usage")


class Finding(BaseModel):
    resource_id: str
    title: str
    cvss: float = Field(ge=0, le=10)
    exposure: float = Field(ge=0, le=1, description="internet/lateral exposure 0-1")


class AnalyzeRequest(BaseModel):
    resource: Resource
    findings: list[Finding] = []
    remediation_cost: float = Field(default=0, ge=0, description="one-off cost in USD")


class Proposal(BaseModel):
    resource_id: str
    action: Action
    security_risk: float
    financial_waste: float
    net_risk: float
    monthly_savings: float
    one_off_cost: float
    payback_months: float | None
    requires_approval: bool
    rationale: str
    terraform_diff: str
    terraform_target: str | None = None
    llm_summary: str | None = None


class Portfolio(BaseModel):
    proposals: list[Proposal]
    total_monthly_savings: float
    critical_count: int
    approvals_required: int
